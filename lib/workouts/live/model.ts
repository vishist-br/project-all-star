/**
 * View-model of the live workout screen. Pure: no React, no clock, no network, so it is unit
 * tested in node. The screen keeps one `RowState` per planned set; this file builds them from the
 * plan (targets), the member's last session and what is already saved, turns a ticked row into an
 * API set, and answers "what is next", "how far along" and "what did we do".
 */
import { groupIntoBlocks } from "../supersets";
import { makeSetClientId, type SetPayload } from "../../customer/queue";

export type MetricType = "WEIGHT_REPS" | "REPS" | "TIME" | "DISTANCE_TIME" | "SCORE" | "CHECKLIST";
export type SetType = "normal" | "warmup" | "drop" | "failure";
export const SET_TYPES: readonly SetType[] = ["normal", "warmup", "drop", "failure"];
export const METRIC_TYPES: readonly MetricType[] = ["WEIGHT_REPS", "REPS", "TIME", "DISTANCE_TIME", "SCORE", "CHECKLIST"];

export function asMetric(v: string | null | undefined): MetricType {
  return (METRIC_TYPES as readonly string[]).includes(v ?? "") ? (v as MetricType) : "WEIGHT_REPS";
}

/** One exercise of today's plan, as the schedule returns it (plain values only: it crosses to the browser). */
export type LiveItem = {
  assignmentId: string;
  planId: string;
  planTitle: string;
  planItemId: string;
  exerciseId: string;
  exerciseName: string;
  metricType: MetricType;
  position: number;
  sets: number | null;
  reps: number | null;
  durationSeconds: number | null;
  restSeconds: number | null;
  targetWeightKg: number | null;
  targetDistanceMeters: number | null;
  supersetGroup: string | null;
  rounds: number | null;
  notes: string | null;
  status: "pending" | "started" | "stopped" | "completed" | "skipped";
};

/** A set that is already stored on the server (or waiting in the queue). */
export type SavedSet = {
  clientId?: string;
  setNumber: number;
  setType: SetType;
  weightKg: number | null;
  reps: number | null;
  seconds: number | null;
  meters: number | null;
  scoreMade: number | null;
  scoreOf: number | null;
  rating: number | null;
};

export type LiveBlock = {
  key: string;
  type: "single" | "superset";
  label: string | null;
  /** Rounds of a superset, 1 for a single exercise. */
  rounds: number;
  items: LiveItem[];
};

export const itemKeyOf = (i: Pick<LiveItem, "assignmentId" | "planItemId">) => `${i.assignmentId}:${i.planItemId}`;

/** Rows planned for one exercise: a superset item has one per round, a single one has `sets` (a check has one). */
export function rowCount(item: LiveItem, block: Pick<LiveBlock, "type" | "rounds">): number {
  if (block.type === "superset") return clamp(block.rounds, 1, 20);
  if (item.metricType === "CHECKLIST") return 1;
  return clamp(item.sets ?? 1, 1, 20);
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Today's items (already in plan order) as blocks: single exercises and supersets with rounds. Skipped items are left out. */
export function buildBlocks(items: readonly LiveItem[]): LiveBlock[] {
  const open = items.filter((i) => i.status !== "skipped");
  return groupIntoBlocks([...open], (i) => `${i.assignmentId}`).map((b, n) => {
    const first = b.items[0]!;
    return {
      key: `${b.type}-${n}-${first.planItemId}`,
      type: b.type,
      label: b.label,
      rounds: b.type === "superset" ? clamp(b.rounds ?? first.sets ?? 1, 1, 20) : 1,
      items: b.items,
    };
  });
}

// ---- rows ----

export type RowState = {
  clientId: string;
  setNumber: number;
  setType: SetType;
  weight: string;
  reps: string;
  seconds: string;
  meters: string;
  made: string;
  outOf: string;
  done: boolean;
};

const str = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));

/** Row for set `setNumber`, pre-filled from the plan's targets and the member's last session. */
export function prefillRow(item: LiveItem, setNumber: number, last: readonly SavedSet[], memberId: string, date: string): RowState {
  const prev = last[setNumber - 1] ?? last[last.length - 1];
  const row: RowState = {
    clientId: makeSetClientId(memberId, item.assignmentId, item.planItemId, date, setNumber),
    setNumber,
    setType: "normal",
    weight: "",
    reps: "",
    seconds: "",
    meters: "",
    made: "",
    outOf: "",
    done: false,
  };
  switch (item.metricType) {
    case "WEIGHT_REPS":
      row.weight = str(item.targetWeightKg ?? prev?.weightKg);
      row.reps = str(item.reps ?? prev?.reps);
      break;
    case "REPS":
      row.reps = str(item.reps ?? prev?.reps);
      break;
    case "TIME":
      row.seconds = str(item.durationSeconds ?? prev?.seconds);
      break;
    case "DISTANCE_TIME":
      row.meters = str(item.targetDistanceMeters ?? prev?.meters);
      row.seconds = str(prev?.seconds);
      break;
    case "SCORE":
      row.outOf = str(item.reps ?? prev?.scoreOf);
      break;
    case "CHECKLIST":
      break;
  }
  return row;
}

/** The row of a set that is already saved: its values, ticked. */
export function rowFromSaved(base: RowState, s: SavedSet): RowState {
  return {
    ...base,
    setType: s.setType,
    weight: str(s.weightKg),
    reps: str(s.reps),
    seconds: str(s.seconds),
    meters: str(s.meters),
    made: str(s.scoreMade),
    outOf: str(s.scoreOf),
    done: true,
  };
}

/** Saved-set shape of a payload that is still waiting in the queue. */
export function savedFromPayload(p: SetPayload): SavedSet {
  return {
    clientId: p.clientId,
    setNumber: p.setNumber,
    setType: p.setType ?? "normal",
    weightKg: p.weightKg ?? null,
    reps: p.reps ?? null,
    seconds: p.seconds ?? null,
    meters: p.meters ?? null,
    scoreMade: p.scoreMade ?? null,
    scoreOf: p.scoreOf ?? null,
    rating: p.rating ?? null,
  };
}

/**
 * Rows of one exercise: the planned ones (pre-filled) with saved sets laid over them, then saved sets
 * beyond the plan (extra sets the member added). `saved` may hold server sets and queued ones; the later wins.
 */
export function buildRows(item: LiveItem, block: Pick<LiveBlock, "type" | "rounds">, last: readonly SavedSet[], saved: readonly SavedSet[], memberId: string, date: string): RowState[] {
  const planned = rowCount(item, block);
  const byNumber = new Map<number, SavedSet>();
  for (const s of saved) byNumber.set(s.setNumber, s);
  const lastWork = last.filter((s) => s.setType !== "warmup");
  const total = Math.max(planned, ...[...byNumber.keys()]);
  const rows: RowState[] = [];
  for (let n = 1; n <= total; n++) {
    const base = prefillRow(item, n, lastWork, memberId, date);
    const s = byNumber.get(n);
    rows.push(s ? rowFromSaved(base, s) : base);
  }
  return rows;
}

// ---- parsing and the API set ----

/** "42,5" and "42.5" both read as 42.5. Empty or not a number gives null. */
export function parseNum(raw: string): number | null {
  const v = raw.trim().replace(",", ".");
  if (v === "" || !/^\d+(\.\d+)?$/.test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseInteger(raw: string): number | null {
  const n = parseNum(raw);
  return n !== null && Number.isInteger(n) ? n : null;
}

export type RowProblem = "empty" | "scoreOrder";
export type ToSet = { ok: true; set: SetPayload } | { ok: false; problem: RowProblem; field: "weight" | "reps" | "seconds" | "meters" | "made" | "outOf" };

/** Turns a ticked row into the API's set, or says what is missing (and which field to focus). */
export function rowToSet(metric: MetricType, row: RowState, completedAt?: string): ToSet {
  const base = { clientId: row.clientId, setNumber: row.setNumber, ...(completedAt ? { completedAt } : {}) };
  const reps = parseInteger(row.reps);
  const seconds = parseInteger(row.seconds);
  const meters = parseInteger(row.meters);
  const weight = parseNum(row.weight);
  switch (metric) {
    case "WEIGHT_REPS": {
      // Reps are needed; the weight is optional (bodyweight work).
      if (reps === null || reps > 1000) return { ok: false, problem: "empty", field: "reps" };
      if (weight !== null && weight > 1000) return { ok: false, problem: "empty", field: "weight" };
      return {
        ok: true,
        set: { ...base, setType: row.setType, ...(weight !== null ? { weightKg: Math.round(weight * 100) / 100 } : {}), ...(reps !== null ? { reps } : {}) },
      };
    }
    case "REPS":
      if (reps === null || reps < 1) return { ok: false, problem: "empty", field: "reps" };
      return { ok: true, set: { ...base, reps } };
    case "TIME":
      if (seconds === null || seconds < 1) return { ok: false, problem: "empty", field: "seconds" };
      return { ok: true, set: { ...base, seconds } };
    case "DISTANCE_TIME":
      if (meters === null || meters < 1) return { ok: false, problem: "empty", field: "meters" };
      return { ok: true, set: { ...base, meters, ...(seconds !== null && seconds > 0 ? { seconds } : {}) } };
    case "SCORE": {
      const made = parseInteger(row.made);
      const of = parseInteger(row.outOf);
      if (made === null) return { ok: false, problem: "empty", field: "made" };
      if (of === null || of < 1) return { ok: false, problem: "empty", field: "outOf" };
      if (made > of) return { ok: false, problem: "scoreOrder", field: "made" };
      return { ok: true, set: { ...base, scoreMade: made, scoreOf: of } };
    }
    case "CHECKLIST":
      // The coach gives the rating; the member marks the walk-through as done (one pass).
      return { ok: true, set: { ...base, reps: 1 } };
  }
}

// ---- order, focus, progress ----

export type Slot = { itemKey: string; blockIndex: number; itemIndex: number; setNumber: number };
export type RowsByItem = Record<string, RowState[]>;

/**
 * The order the member works in: a single exercise set by set, a superset round by round (every
 * exercise of round 1, then round 2, ...). Extra sets added beyond the plan come after the plan.
 */
export function executionOrder(blocks: readonly LiveBlock[], rows: RowsByItem): Slot[] {
  const out: Slot[] = [];
  blocks.forEach((b, blockIndex) => {
    if (b.type === "single") {
      const it = b.items[0]!;
      const key = itemKeyOf(it);
      for (const r of rows[key] ?? []) out.push({ itemKey: key, blockIndex, itemIndex: 0, setNumber: r.setNumber });
      return;
    }
    const maxSet = Math.max(0, ...b.items.map((it) => (rows[itemKeyOf(it)] ?? []).length));
    for (let n = 1; n <= maxSet; n++) {
      b.items.forEach((it, itemIndex) => {
        const key = itemKeyOf(it);
        if ((rows[key] ?? []).some((r) => r.setNumber === n)) out.push({ itemKey: key, blockIndex, itemIndex, setNumber: n });
      });
    }
  });
  return out;
}

const isDone = (rows: RowsByItem, s: Slot) => rows[s.itemKey]?.find((r) => r.setNumber === s.setNumber)?.done === true;

/** The next set still open after `from` (wrapping to the first open one), or null when everything is done. */
export function nextOpenSlot(order: readonly Slot[], rows: RowsByItem, from?: Pick<Slot, "itemKey" | "setNumber">): Slot | null {
  const at = from ? order.findIndex((s) => s.itemKey === from.itemKey && s.setNumber === from.setNumber) : -1;
  for (let i = at + 1; i < order.length; i++) if (!isDone(rows, order[i]!)) return order[i]!;
  for (let i = 0; i <= at && i < order.length; i++) if (!isDone(rows, order[i]!)) return order[i]!;
  return null;
}

export type Progress = {
  done: number;
  total: number;
  percent: number;
  /** The block the next open set belongs to (null when all done). */
  current: { blockIndex: number; type: "single" | "superset"; label: string | null; round: number; rounds: number; exercise: number; exercises: number } | null;
};

export function progressOf(blocks: readonly LiveBlock[], rows: RowsByItem): Progress {
  const order = executionOrder(blocks, rows);
  const done = order.filter((s) => isDone(rows, s)).length;
  const total = order.length;
  const next = nextOpenSlot(order, rows);
  let current: Progress["current"] = null;
  if (next) {
    const b = blocks[next.blockIndex]!;
    current =
      b.type === "superset"
        ? { blockIndex: next.blockIndex, type: "superset", label: b.label, round: next.setNumber, rounds: Math.max(b.rounds, next.setNumber), exercise: next.itemIndex + 1, exercises: b.items.length }
        : { blockIndex: next.blockIndex, type: "single", label: null, round: next.setNumber, rounds: (rows[next.itemKey] ?? []).length, exercise: next.blockIndex + 1, exercises: blocks.length };
  }
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100), current };
}

/**
 * Rest after ticking set `setNumber` of item `itemIndex` in a block, or null for no rest. A single
 * exercise rests after every set. A superset rests once, after the last exercise of the round is done
 * (so the member goes straight from one exercise to the next), for the shared rest of the group.
 */
export function restAfterTick(block: LiveBlock, itemIndex: number, setNumber: number, rows: RowsByItem): number | null {
  if (block.type === "single") return positive(block.items[0]!.restSeconds);
  const roundDone = block.items.every((it, i) => i === itemIndex || (rows[itemKeyOf(it)] ?? []).find((r) => r.setNumber === setNumber)?.done === true);
  if (!roundDone) return null;
  const shared = block.items[block.items.length - 1]!.restSeconds ?? Math.max(0, ...block.items.map((i) => i.restSeconds ?? 0));
  return positive(shared);
}

const positive = (n: number | null | undefined) => (n && n > 0 ? n : null);

// ---- totals for the finish summary ----

export type Totals = { setsDone: number; setsPlanned: number; exercises: number; reps: number; volumeKg: number; seconds: number; meters: number };

/** Warm-up sets are not counted in volume (same rule as the records). */
export function totalsOf(blocks: readonly LiveBlock[], rows: RowsByItem): Totals {
  const t: Totals = { setsDone: 0, setsPlanned: 0, exercises: 0, reps: 0, volumeKg: 0, seconds: 0, meters: 0 };
  for (const b of blocks) {
    for (const it of b.items) {
      const list = rows[itemKeyOf(it)] ?? [];
      t.setsPlanned += list.length;
      const done = list.filter((r) => r.done);
      if (done.length > 0) t.exercises += 1;
      for (const r of done) {
        t.setsDone += 1;
        if (r.setType === "warmup") continue;
        const reps = parseInteger(r.reps) ?? 0;
        const w = parseNum(r.weight) ?? 0;
        t.reps += reps;
        t.volumeKg += w * reps;
        t.seconds += parseInteger(r.seconds) ?? 0;
        t.meters += parseInteger(r.meters) ?? 0;
      }
    }
  }
  t.volumeKg = Math.round(t.volumeKg * 10) / 10;
  return t;
}

/** 75 -> "1:15", 3725 -> "1:02:05". */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}

/** The row to show in "Last time" for a set: its weight and reps (or the metric's own value) as parts. */
export function lastTimeParts(metric: MetricType, s: SavedSet | undefined): { weight?: number; reps?: number; seconds?: number; meters?: number; made?: number; of?: number; rating?: number } | null {
  if (!s) return null;
  switch (metric) {
    case "WEIGHT_REPS":
      return s.weightKg === null && s.reps === null ? null : { ...(s.weightKg !== null ? { weight: s.weightKg } : {}), ...(s.reps !== null ? { reps: s.reps } : {}) };
    case "REPS":
      return s.reps === null ? null : { reps: s.reps };
    case "TIME":
      return s.seconds === null ? null : { seconds: s.seconds };
    case "DISTANCE_TIME":
      return s.meters === null ? null : { meters: s.meters, ...(s.seconds !== null ? { seconds: s.seconds } : {}) };
    case "SCORE":
      return s.scoreMade === null || s.scoreOf === null ? null : { made: s.scoreMade, of: s.scoreOf };
    case "CHECKLIST":
      return s.rating === null ? null : { rating: s.rating };
  }
}

/** Newest "new best" per exercise, for the finish summary. */
export type NewBest = { metric: string; value: number; previous: number | null };
