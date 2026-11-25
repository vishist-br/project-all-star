import { toEntry, type QueueItem } from "./queue";

/**
 * "Finish class and send" saved on this device. When the coach finishes a class with no signal, the
 * marks stay in the roll-call queue and this intent waits beside it. Once the marks are on the server
 * the intent is sent (roll call complete, then the class summary). Pure logic, unit-tested; the
 * browser hook only moves it in and out of localStorage.
 */
export type FinishEntry = Pick<QueueItem, "memberId" | "status" | "reason" | "note" | "clientId">;
export type FinishIntent = {
  sessionId: string;
  entries: FinishEntry[];
  coachNote: string | null;
  homePractice: string | null;
  createdAt: string;
  attempts: number;
};

const KEY_PREFIX = "rollcall.finish.v1.";
export const finishKey = (userId: string) => KEY_PREFIX + userId;
export const MAX_FINISH_ATTEMPTS = 6;

const clip = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export function makeIntent(input: { sessionId: string; entries: readonly FinishEntry[]; coachNote?: string | null; homePractice?: string | null }, now = new Date()): FinishIntent {
  return {
    sessionId: input.sessionId,
    entries: input.entries.map((e) => ({ memberId: e.memberId, status: e.status, reason: e.reason, note: e.note, clientId: e.clientId })),
    coachNote: clip(input.coachNote, 1000),
    homePractice: clip(input.homePractice, 1000),
    createdAt: now.toISOString(),
    attempts: 0,
  };
}

/** One intent per session: finishing again replaces the earlier one. */
export function addIntent(list: readonly FinishIntent[], intent: FinishIntent): FinishIntent[] {
  return [...list.filter((i) => i.sessionId !== intent.sessionId), intent];
}

export function removeIntent(list: readonly FinishIntent[], sessionId: string): FinishIntent[] {
  return list.filter((i) => i.sessionId !== sessionId);
}

/** Intents that may be sent now: none of the session's roll-call marks is still waiting on the device. */
export function readyIntents(list: readonly FinishIntent[], queue: readonly Pick<QueueItem, "sessionId" | "state">[]): FinishIntent[] {
  return list.filter((i) => i.attempts < MAX_FINISH_ATTEMPTS && !queue.some((q) => q.sessionId === i.sessionId && q.state === "queued"));
}

export function bumpAttempt(list: readonly FinishIntent[], sessionId: string): FinishIntent[] {
  return list.map((i) => (i.sessionId === sessionId ? { ...i, attempts: i.attempts + 1 } : i));
}

/** The body sent to finishClassAction. Entries repeat the marks, which is safe: same clientId and values is a replay. */
export function intentBody(i: FinishIntent) {
  return { entries: i.entries.map((e) => toEntry(e)), coachNote: i.coachNote, homePractice: i.homePractice };
}

const STATUSES = ["present", "absent", "excused"];
const REASONS = ["exam", "illness", "festival", "travel"];

export function parseIntents(raw: string | null): FinishIntent[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    const out: FinishIntent[] = [];
    for (const v of data) {
      if (typeof v !== "object" || v === null) continue;
      const o = v as Record<string, unknown>;
      if (typeof o.sessionId !== "string" || !Array.isArray(o.entries) || typeof o.createdAt !== "string") continue;
      const entries: FinishEntry[] = [];
      for (const e of o.entries) {
        if (typeof e !== "object" || e === null) continue;
        const x = e as Record<string, unknown>;
        if (typeof x.memberId !== "string" || typeof x.status !== "string" || !STATUSES.includes(x.status)) continue;
        if (typeof x.clientId !== "string" || x.clientId.length < 8 || x.clientId.length > 64) continue;
        entries.push({
          memberId: x.memberId,
          status: x.status as FinishEntry["status"],
          reason: typeof x.reason === "string" && REASONS.includes(x.reason) ? (x.reason as FinishEntry["reason"]) : null,
          note: typeof x.note === "string" ? x.note.slice(0, 280) : null,
          clientId: x.clientId,
        });
      }
      if (entries.length === 0) continue;
      out.push({
        sessionId: o.sessionId,
        entries,
        coachNote: clip(o.coachNote, 1000),
        homePractice: clip(o.homePractice, 1000),
        createdAt: o.createdAt,
        attempts: typeof o.attempts === "number" && Number.isFinite(o.attempts) ? o.attempts : 0,
      });
    }
    return out;
  } catch {
    return [];
  }
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const memory = new Map<string, string>();

export function loadIntents(userId: string, storage?: StorageLike): FinishIntent[] {
  try {
    const s = storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
    if (!s) throw new Error("no storage");
    return parseIntents(s.getItem(finishKey(userId)));
  } catch {
    return parseIntents(memory.get(finishKey(userId)) ?? null);
  }
}

export function saveIntents(userId: string, list: readonly FinishIntent[], storage?: StorageLike): void {
  const json = JSON.stringify(list);
  try {
    const s = storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
    if (!s) throw new Error("no storage");
    if (list.length === 0) s.removeItem(finishKey(userId));
    else s.setItem(finishKey(userId), json);
  } catch {
    memory.set(finishKey(userId), json);
  }
}
