import type { QueueItem } from "./queue";

const PREFIX = "rollcall.queue.v1.";
const STATES = ["queued", "conflict", "failed"];
const STATUSES = ["present", "absent", "excused"];
const REASONS = ["exam", "illness", "festival", "travel"];

/** Parses stored JSON defensively: anything malformed is dropped, never thrown. */
export function parseQueue(raw: string | null): QueueItem[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    const out: QueueItem[] = [];
    for (const v of data) {
      if (typeof v !== "object" || v === null) continue;
      const o = v as Record<string, unknown>;
      if (
        typeof o.clientId !== "string" || o.clientId.length < 8 || o.clientId.length > 64 ||
        typeof o.sessionId !== "string" || typeof o.memberId !== "string" ||
        typeof o.status !== "string" || !STATUSES.includes(o.status) ||
        typeof o.markedAt !== "string" || Number.isNaN(Date.parse(o.markedAt))
      ) continue;
      out.push({
        clientId: o.clientId,
        sessionId: o.sessionId,
        memberId: o.memberId,
        status: o.status as QueueItem["status"],
        reason: typeof o.reason === "string" && REASONS.includes(o.reason) ? (o.reason as QueueItem["reason"]) : null,
        note: typeof o.note === "string" ? o.note.slice(0, 280) : null,
        markedAt: o.markedAt,
        state: typeof o.state === "string" && STATES.includes(o.state) ? (o.state as QueueItem["state"]) : "queued",
        attempts: typeof o.attempts === "number" && Number.isFinite(o.attempts) ? o.attempts : 0,
        ...(typeof o.error === "string" ? { error: o.error } : {}),
      });
    }
    return out;
  } catch {
    return [];
  }
}

export type QueueStore = {
  load(): QueueItem[];
  save(queue: readonly QueueItem[]): void;
  /** false when the browser blocks storage; the queue then lives in memory until the page closes. */
  persistent(): boolean;
};

const memory = new Map<string, string>();

function defaultStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * localStorage-backed store, namespaced by user so a shared device never replays someone else's
 * marks. Every access is wrapped in try/catch (private windows and blocked storage throw); when
 * storage is unusable the queue falls back to memory and keeps working for this page.
 */
export function createQueueStore(userId: string, getStorage: () => Storage | undefined = defaultStorage): QueueStore {
  const key = PREFIX + userId;
  let ok = true;
  return {
    load() {
      try {
        const s = getStorage();
        if (!s) throw new Error("no storage");
        const raw = s.getItem(key);
        ok = true;
        return parseQueue(raw);
      } catch {
        ok = false;
        return parseQueue(memory.get(key) ?? null);
      }
    },
    save(queue) {
      const json = JSON.stringify(queue);
      try {
        const s = getStorage();
        if (!s) throw new Error("no storage");
        if (queue.length === 0) s.removeItem(key);
        else s.setItem(key, json);
        ok = true;
      } catch {
        ok = false;
        memory.set(key, json);
      }
    },
    persistent: () => ok,
  };
}
