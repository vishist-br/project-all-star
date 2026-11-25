// Offline queue for the customer's workout actions (start, stop, complete, skip) and, for the live
// workout screen, per-set saves (recordWorkoutSets) that carry the set clientId so retries converge.
// Pure logic: no React, no fetch, no direct localStorage access, so it is unit tested in node.
// The queue keeps the order of the taps and replays it in that order when the connection returns.

export type LogAction = "start" | "stop" | "complete" | "skip";
export type ItemStatus = "pending" | "started" | "stopped" | "completed" | "skipped";

/** One tap, saved on the phone until the server has accepted it. */
export type ItemOp = {
  /** One id per item and day. Every action on that item-day reuses it. */
  clientId: string;
  memberId: string;
  assignmentId: string;
  planItemId: string;
  /** The plan day the item belongs to (YYYY-MM-DD). */
  scheduledFor: string;
  action: LogAction;
  /** Device time of the tap (ISO). The server clamps clocks that run ahead. */
  occurredAt: string;
};

export type SetPayload = {
  /** Device-generated id of the set; the same set always gets the same id (see makeSetClientId). */
  clientId: string;
  setNumber: number;
  setType?: "normal" | "warmup" | "drop" | "failure";
  weightKg?: number;
  reps?: number;
  seconds?: number;
  meters?: number;
  scoreMade?: number;
  scoreOf?: number;
  rating?: number;
  /** Device time the set was ticked (ISO). The server clamps clocks that run ahead. */
  completedAt?: string;
};

/**
 * Sets of one exercise on one day, saved on the phone until the server has accepted them
 * (recordWorkoutSets). `clientId` is the log id (the same one the item-level flow uses for that
 * item-day), every set has its own id, so replaying the same op twice converges on the same rows.
 */
export type SetOp = {
  kind: "sets";
  /** What the save means for the item's status: "complete" when it also finishes the exercise, else "start". */
  action: "start" | "complete";
  clientId: string;
  memberId: string;
  assignmentId: string;
  planItemId: string;
  scheduledFor: string;
  sets: SetPayload[];
  /** True when this save also finishes the exercise (moves the log to completed). */
  complete: boolean;
  occurredAt: string;
};

export type QueuedOp = ItemOp | SetOp;

export function isSetOp(op: QueuedOp): op is SetOp {
  return "kind" in op && op.kind === "sets";
}

export const QUEUE_KEY = "workoutQueue.v1";
export const MAX_QUEUE = 200;

export function itemKey(assignmentId: string, planItemId: string, scheduledFor: string): string {
  return `${assignmentId}|${planItemId}|${scheduledFor}`;
}

/** cyrb53: a small, fast 53-bit string hash. Good enough to make ids that differ per item-day. */
function cyrb53(str: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * The idempotency id for an item on a day: the same item-day always gives the same id (so a retry or
 * a second device converges on one log), a different item or day gives a different id.
 * Length 31, inside the API's 8..64 range.
 */
export function makeClientId(memberId: string, assignmentId: string, planItemId: string, scheduledFor: string): string {
  const key = `${memberId}|${itemKey(assignmentId, planItemId, scheduledFor)}`;
  return `wl-${cyrb53(key, 1).toString(16).padStart(14, "0")}${cyrb53(key, 7).toString(16).padStart(14, "0")}`;
}

/** Idempotency id of one set: same member, item, day and set number always give the same id. Length 31. */
export function makeSetClientId(memberId: string, assignmentId: string, planItemId: string, scheduledFor: string, setNumber: number): string {
  const key = `${memberId}|${itemKey(assignmentId, planItemId, scheduledFor)}|${setNumber}`;
  return `ws-${cyrb53(key, 3).toString(16).padStart(14, "0")}${cyrb53(key, 11).toString(16).padStart(14, "0")}`;
}

/** Same state machine as the API (`nextStatus` in lib/api/workout-logs.ts). null = not allowed. */
export function nextItemStatus(current: ItemStatus, action: LogAction): ItemStatus | null {
  const target: Record<LogAction, ItemStatus> = { start: "started", stop: "stopped", complete: "completed", skip: "skipped" };
  const to = target[action];
  if (current === "pending") return action === "stop" ? null : to;
  if (current === to) return current;
  const allowed: Record<Exclude<ItemStatus, "pending">, ItemStatus[]> = {
    started: ["stopped", "completed"],
    stopped: ["started", "completed"],
    completed: [],
    skipped: [],
  };
  return allowed[current].includes(to) ? to : null;
}

/** Buttons offered for a status: pending -> Start or Skip, started -> Stop or Complete, stopped -> Resume or Complete. */
export function availableActions(status: ItemStatus): LogAction[] {
  switch (status) {
    case "pending":
      return ["start", "skip"];
    case "started":
      return ["stop", "complete"];
    case "stopped":
      return ["start", "complete"];
    default:
      return [];
  }
}

export function makeOp(
  input: { memberId: string; assignmentId: string; planItemId: string; scheduledFor: string; action: LogAction },
  now: Date = new Date(),
): ItemOp {
  return {
    clientId: makeClientId(input.memberId, input.assignmentId, input.planItemId, input.scheduledFor),
    memberId: input.memberId,
    assignmentId: input.assignmentId,
    planItemId: input.planItemId,
    scheduledFor: input.scheduledFor,
    action: input.action,
    occurredAt: now.toISOString(),
  };
}

/** A queued save of sets (one or more ticked sets of one exercise). */
export function makeSetsOp(
  input: { memberId: string; assignmentId: string; planItemId: string; scheduledFor: string; sets: SetPayload[]; complete?: boolean },
  now: Date = new Date(),
): SetOp {
  return {
    kind: "sets",
    clientId: makeClientId(input.memberId, input.assignmentId, input.planItemId, input.scheduledFor),
    memberId: input.memberId,
    assignmentId: input.assignmentId,
    planItemId: input.planItemId,
    scheduledFor: input.scheduledFor,
    sets: input.sets,
    complete: input.complete === true,
    action: input.complete === true ? "complete" : "start",
    occurredAt: now.toISOString(),
  };
}

/** Body of PUT /workout-sets (recordWorkoutSets). */
export function buildSetsPayload(op: SetOp) {
  return {
    clientId: op.clientId,
    assignmentId: op.assignmentId,
    planItemId: op.planItemId,
    memberId: op.memberId,
    scheduledFor: op.scheduledFor,
    sets: op.sets,
    complete: op.complete,
  };
}

/** Body of PUT /workout-logs (recordWorkoutLog). */
export function buildLogPayload(op: ItemOp) {
  return {
    clientId: op.clientId,
    assignmentId: op.assignmentId,
    planItemId: op.planItemId,
    memberId: op.memberId,
    scheduledFor: op.scheduledFor,
    action: op.action,
    occurredAt: op.occurredAt,
  };
}

/** Adds an op at the end. A double tap (same item-day and action as the last queued one) is ignored. */
export function enqueue(queue: readonly QueuedOp[], op: QueuedOp): QueuedOp[] {
  if (isSetOp(op)) {
    // Saving the very same sets again (a double tap, a re-render) adds nothing.
    const prev = [...queue].reverse().find((q) => q.clientId === op.clientId);
    if (prev && isSetOp(prev) && prev.complete === op.complete && JSON.stringify(prev.sets) === JSON.stringify(op.sets)) return [...queue];
    const next = [...queue, op];
    return next.length > MAX_QUEUE ? next.slice(next.length - MAX_QUEUE) : next;
  }
  const last = [...queue].reverse().find((q) => q.clientId === op.clientId && !isSetOp(q)) as ItemOp | undefined;
  if (last && last.action === op.action) return [...queue];
  const next = [...queue, op];
  return next.length > MAX_QUEUE ? next.slice(next.length - MAX_QUEUE) : next;
}

/** The status to show: the server's status with every queued tap for the item applied in order. */
export function effectiveStatus(base: ItemStatus, ops: readonly QueuedOp[]): ItemStatus {
  let s = base;
  for (const op of ops) s = nextItemStatus(s, op.action) ?? s;
  return s;
}

export function opsFor(queue: readonly QueuedOp[], key: string): QueuedOp[] {
  return queue.filter((q) => itemKey(q.assignmentId, q.planItemId, q.scheduledFor) === key);
}

export type SendResult =
  | { kind: "ok"; status?: ItemStatus; /** Body of a saved-sets answer (sets and newBests). */ data?: unknown }
  /** Network down or server trouble: keep the op and everything after it, try again later. */
  | { kind: "retry"; reason?: "network" | "server" | "unauthorized" }
  /** The server said no for good (conflict, not scheduled, not yours): drop the op and say why. */
  | { kind: "reject"; code: string; message: string };

export type ReplayResult = {
  remaining: QueuedOp[];
  synced: { op: QueuedOp; status?: ItemStatus; data?: unknown }[];
  rejected: { op: QueuedOp; code: string; message: string }[];
  /** True when replay stopped early because the connection or server was unavailable. */
  interrupted: boolean;
  /** Why it stopped, when it did. */
  reason?: "network" | "server" | "unauthorized";
};

/** Two queue entries are the same tap when id, action and device time match (objects may be reloaded from storage). */
export function sameOp(a: QueuedOp, b: QueuedOp): boolean {
  if (isSetOp(a) || isSetOp(b)) {
    return isSetOp(a) && isSetOp(b) && a.clientId === b.clientId && a.occurredAt === b.occurredAt && a.sets.map((x) => x.clientId).join() === b.sets.map((x) => x.clientId).join();
  }
  return a.clientId === b.clientId && a.action === b.action && a.occurredAt === b.occurredAt;
}

/**
 * Sends the queued ops one at a time, in order. A `retry` stops the replay and keeps that op and the
 * rest (order matters: a complete must not overtake its start). A `reject` drops only that op.
 * `onStep` is called after every op the server settled (ok or reject), so the caller can remove it
 * from the persisted queue right away, even if a later op is interrupted.
 */
export async function replayQueue(
  queue: readonly QueuedOp[],
  send: (op: QueuedOp) => Promise<SendResult>,
  onStep?: (op: QueuedOp, result: SendResult) => void,
): Promise<ReplayResult> {
  const remaining = [...queue];
  const synced: ReplayResult["synced"] = [];
  const rejected: ReplayResult["rejected"] = [];
  let interrupted = false;
  let reason: ReplayResult["reason"];
  while (remaining.length > 0) {
    const op = remaining[0]!;
    let res: SendResult;
    try {
      res = await send(op);
    } catch {
      res = { kind: "retry" };
    }
    if (res.kind === "retry") {
      interrupted = true;
      reason = res.reason ?? "network";
      break;
    }
    remaining.shift();
    if (res.kind === "ok") synced.push({ op, status: res.status, data: res.data });
    else rejected.push({ op, code: res.code, message: res.message });
    onStep?.(op, res);
  }
  return { remaining, synced, rejected, interrupted, reason };
}

// ---- persistence ----

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const ACTIONS: readonly string[] = ["start", "stop", "complete", "skip"];

function isSetEntry(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.clientId === "string" && typeof o.setNumber === "number";
}

function isOp(v: unknown): v is QueuedOp {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (o.kind === "sets") {
    return (
      typeof o.clientId === "string" &&
      typeof o.memberId === "string" &&
      typeof o.assignmentId === "string" &&
      typeof o.planItemId === "string" &&
      typeof o.scheduledFor === "string" &&
      typeof o.occurredAt === "string" &&
      typeof o.complete === "boolean" &&
      (o.action === "start" || o.action === "complete") &&
      Array.isArray(o.sets) &&
      o.sets.length > 0 &&
      o.sets.every(isSetEntry)
    );
  }
  return (
    typeof o.clientId === "string" &&
    typeof o.memberId === "string" &&
    typeof o.assignmentId === "string" &&
    typeof o.planItemId === "string" &&
    typeof o.scheduledFor === "string" &&
    typeof o.occurredAt === "string" &&
    typeof o.action === "string" &&
    ACTIONS.includes(o.action)
  );
}

/** Reads the saved queue. Anything unreadable (private mode, blocked storage, bad JSON) is an empty queue. */
export function loadQueue(storage: StorageLike | null | undefined): QueuedOp[] {
  try {
    const raw = storage?.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isOp) : [];
  } catch {
    return [];
  }
}

/** Saves the queue; returns false when storage is unavailable (the queue then lives in memory only). */
export function saveQueue(storage: StorageLike | null | undefined, queue: readonly QueuedOp[]): boolean {
  try {
    if (!storage) return false;
    if (queue.length === 0) storage.removeItem(QUEUE_KEY);
    else storage.setItem(QUEUE_KEY, JSON.stringify(queue));
    return true;
  } catch {
    return false;
  }
}
