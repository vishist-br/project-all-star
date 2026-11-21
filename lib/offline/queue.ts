/**
 * Offline roll-call queue: pure logic (no browser APIs), so it is unit-tested and shared by the
 * browser hook. A "mark" is one tap on one member. Each mark has a stable clientId, so sending it
 * twice is safe (the API treats the same clientId + same values as an exact replay).
 */
export type MarkStatus = "present" | "absent" | "excused";
export const EXCUSE_REASONS = ["exam", "illness", "festival", "travel"] as const;
export type ExcuseReason = (typeof EXCUSE_REASONS)[number];

/** queued = waiting to be sent; conflict = the server refused it (409), never retried; failed = refused for another reason or too many tries. */
export type QueueState = "queued" | "conflict" | "failed";

export type QueueItem = {
  clientId: string;
  sessionId: string;
  memberId: string;
  status: MarkStatus;
  reason: ExcuseReason | null;
  note: string | null;
  /** ISO time of the tap on the device; the server clamps clocks that run ahead. */
  markedAt: string;
  state: QueueState;
  attempts: number;
  error?: string;
};

export type NewMark = Pick<QueueItem, "sessionId" | "memberId" | "status"> & { reason?: ExcuseReason | null; note?: string | null };

export const MAX_ENTRIES_PER_REQUEST = 200;
/** After this many failed sends for a reason other than "no network", stop retrying and surface it. */
export const MAX_ATTEMPTS = 5;

export function newClientId(): string {
  const c = typeof globalThis !== "undefined" ? (globalThis as { crypto?: Crypto }).crypto : undefined;
  if (c?.randomUUID) return `att-${c.randomUUID()}`;
  return `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Adds a mark at the end of the queue. An older, not-yet-sent mark for the same member and
 * session is replaced (only the latest tap matters), and so is an older refused one.
 */
export function enqueue(queue: readonly QueueItem[], mark: NewMark, opts: { now?: Date; clientId?: string } = {}): QueueItem[] {
  const item: QueueItem = {
    clientId: opts.clientId ?? newClientId(),
    sessionId: mark.sessionId,
    memberId: mark.memberId,
    status: mark.status,
    reason: mark.status === "excused" ? (mark.reason ?? null) : null,
    note: mark.note?.trim() ? mark.note.trim().slice(0, 280) : null,
    markedAt: (opts.now ?? new Date()).toISOString(),
    state: "queued",
    attempts: 0,
  };
  return [...queue.filter((q) => !(q.sessionId === item.sessionId && q.memberId === item.memberId)), item];
}

export const pending = (queue: readonly QueueItem[]) => queue.filter((q) => q.state === "queued");
export const problems = (queue: readonly QueueItem[]) => queue.filter((q) => q.state !== "queued");

export type Batch = { sessionId: string; items: QueueItem[] };

/**
 * Replay order: sessions in the order of their first waiting mark, and inside a session the
 * marks in the order they were tapped. One request never holds a member twice or more than 200 marks.
 */
export function buildBatches(queue: readonly QueueItem[]): Batch[] {
  const order: string[] = [];
  const bySession = new Map<string, QueueItem[]>();
  for (const item of pending(queue)) {
    if (!bySession.has(item.sessionId)) {
      bySession.set(item.sessionId, []);
      order.push(item.sessionId);
    }
    bySession.get(item.sessionId)!.push(item);
  }
  const out: Batch[] = [];
  for (const sessionId of order) {
    let current: QueueItem[] = [];
    let seen = new Set<string>();
    for (const item of bySession.get(sessionId)!) {
      if (seen.has(item.memberId) || current.length >= MAX_ENTRIES_PER_REQUEST) {
        out.push({ sessionId, items: current });
        current = [];
        seen = new Set();
      }
      current.push(item);
      seen.add(item.memberId);
    }
    if (current.length) out.push({ sessionId, items: current });
  }
  return out;
}

export function toEntry(item: Pick<QueueItem, "memberId" | "status" | "reason" | "note" | "clientId"> & { markedAt?: string }) {
  return {
    memberId: item.memberId,
    status: item.status,
    ...(item.status === "excused" && item.reason ? { reason: item.reason } : {}),
    ...(item.note ? { note: item.note } : {}),
    clientId: item.clientId,
    ...(item.markedAt ? { markedAt: item.markedAt } : {}),
  };
}

export function buildAttendanceBody(
  items: readonly Parameters<typeof toEntry>[0][],
  extra: { complete?: boolean; coachNote?: string | null } = {},
) {
  return {
    entries: items.map(toEntry),
    ...(extra.complete ? { complete: true } : {}),
    ...(extra.coachNote !== undefined ? { coachNote: extra.coachNote } : {}),
  };
}

/** What the sender reports for one request. */
export type SendOutcome =
  | { kind: "ok" }
  | { kind: "retry"; message?: string }
  | { kind: "reject"; code: string; message: string };

/** Maps a server action result (null = the request never reached the server) to an outcome. */
export function classifyResult(res: { ok: true } | { ok: false; code: string; message: string } | null): SendOutcome {
  if (res === null) return { kind: "retry" };
  if (res.ok) return { kind: "ok" };
  if (res.code === "unauthorized" || res.code === "rate_limited" || res.code === "internal_error" || res.code === "payload_too_large") {
    return { kind: "retry", message: res.message };
  }
  return { kind: "reject", code: res.code, message: res.message };
}

export type ReplayResult = { queue: QueueItem[]; synced: QueueItem[]; offline: boolean };

/**
 * Sends every waiting batch in order. Stops at the first "retry" (no network) so order is kept.
 * A refused batch is re-sent mark by mark, so one bad mark does not block the others. A 409
 * (`conflict`) is parked as state "conflict" and is never retried automatically.
 */
export async function replayQueue(
  start: readonly QueueItem[],
  send: (sessionId: string, items: QueueItem[]) => Promise<SendOutcome>,
  onProgress?: (queue: QueueItem[]) => void,
): Promise<ReplayResult> {
  let queue = [...start];
  const synced: QueueItem[] = [];

  const settle = (items: QueueItem[], outcome: SendOutcome): "stop" | "next" => {
    const ids = new Set(items.map((i) => i.clientId));
    if (outcome.kind === "ok") {
      synced.push(...items);
      queue = queue.filter((q) => !ids.has(q.clientId));
      return "next";
    }
    if (outcome.kind === "retry") {
      queue = queue.map((q) => {
        if (!ids.has(q.clientId)) return q;
        const attempts = q.attempts + 1;
        return attempts >= MAX_ATTEMPTS
          ? { ...q, attempts, state: "failed" as const, error: outcome.message ?? "Could not reach the server" }
          : { ...q, attempts };
      });
      return "stop";
    }
    queue = queue.map((q) =>
      ids.has(q.clientId) ? { ...q, state: outcome.code === "conflict" ? ("conflict" as const) : ("failed" as const), error: outcome.message } : q,
    );
    return "next";
  };

  for (const batch of buildBatches(queue)) {
    const outcome = await send(batch.sessionId, batch.items);
    if (outcome.kind === "reject" && batch.items.length > 1) {
      let stopped = false;
      for (const item of batch.items) {
        if (settle([item], await send(batch.sessionId, [item])) === "stop") {
          stopped = true;
          break;
        }
      }
      onProgress?.(queue);
      if (stopped) return { queue, synced, offline: true };
      continue;
    }
    const verdict = settle(batch.items, outcome);
    onProgress?.(queue);
    if (verdict === "stop") return { queue, synced, offline: true };
  }
  return { queue, synced, offline: false };
}
