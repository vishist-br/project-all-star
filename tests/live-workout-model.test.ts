import { describe, expect, it } from "vitest";
import {
  buildBlocks,
  buildRows,
  executionOrder,
  formatClock,
  itemKeyOf,
  nextOpenSlot,
  parseNum,
  prefillRow,
  progressOf,
  restAfterTick,
  rowToSet,
  totalsOf,
  type LiveItem,
  type RowsByItem,
  type SavedSet,
} from "../lib/workouts/live/model";
import { formatBestValue, formatLast, formatTargets } from "../lib/workouts/live/format";
import { translate } from "../lib/i18n";

const t = (k: Parameters<typeof translate>[1], p?: Parameters<typeof translate>[2]) => translate("en", k, p);
const M = "m1";
const D = "2026-11-25";

function item(over: Partial<LiveItem> & { planItemId: string }): LiveItem {
  return {
    assignmentId: "a1",
    planId: "p1",
    planTitle: "Plan",
    exerciseId: `ex-${over.planItemId}`,
    exerciseName: over.planItemId,
    metricType: "WEIGHT_REPS",
    position: 1,
    sets: 3,
    reps: 8,
    durationSeconds: null,
    restSeconds: 60,
    targetWeightKg: null,
    targetDistanceMeters: null,
    supersetGroup: null,
    rounds: null,
    notes: null,
    status: "pending",
    ...over,
  };
}

const saved = (over: Partial<SavedSet> & { setNumber: number }): SavedSet => ({
  setType: "normal",
  weightKg: null,
  reps: null,
  seconds: null,
  meters: null,
  scoreMade: null,
  scoreOf: null,
  rating: null,
  ...over,
});

function plan() {
  const items = [
    item({ planItemId: "bench", position: 1, supersetGroup: "A", rounds: 3, targetWeightKg: 40, restSeconds: 60 }),
    item({ planItemId: "row", position: 2, supersetGroup: "A", rounds: 3, targetWeightKg: 35, restSeconds: 60 }),
    item({ planItemId: "squat", position: 3, sets: 2, reps: 5, targetWeightKg: 60, restSeconds: 45 }),
  ];
  const blocks = buildBlocks(items);
  const rows: RowsByItem = {};
  for (const b of blocks) for (const it of b.items) rows[itemKeyOf(it)] = buildRows(it, b, [], [], M, D);
  return { items, blocks, rows };
}

describe("blocks and rows", () => {
  it("groups a superset with its rounds and leaves other items single; skipped items are left out", () => {
    const { blocks } = plan();
    expect(blocks.map((b) => [b.type, b.label, b.rounds, b.items.length])).toEqual([
      ["superset", "A", 3, 2],
      ["single", null, 1, 1],
    ]);
    const skipped = buildBlocks([item({ planItemId: "x", status: "skipped" }), item({ planItemId: "y" })]);
    expect(skipped).toHaveLength(1);
  });
  it("plans one row per round in a superset and `sets` rows for a single exercise", () => {
    const { rows } = plan();
    expect(rows["a1:bench"]).toHaveLength(3);
    expect(rows["a1:row"]).toHaveLength(3);
    expect(rows["a1:squat"]).toHaveLength(2);
  });
  it("pre-fills from the plan target, then from the last session", () => {
    const bench = item({ planItemId: "b", targetWeightKg: 40, reps: 8 });
    expect(prefillRow(bench, 1, [], M, D)).toMatchObject({ weight: "40", reps: "8" });
    const free = item({ planItemId: "f", reps: null, targetWeightKg: null });
    const last = [saved({ setNumber: 1, weightKg: 50, reps: 6 }), saved({ setNumber: 2, weightKg: 52.5, reps: 5 })];
    expect(prefillRow(free, 2, last, M, D)).toMatchObject({ weight: "52.5", reps: "5" });
    expect(prefillRow(free, 3, last, M, D)).toMatchObject({ weight: "52.5", reps: "5" }); // beyond last: the last set
  });
  it("prefills each metric type with what it logs", () => {
    expect(prefillRow(item({ planItemId: "t", metricType: "TIME", durationSeconds: 30 }), 1, [], M, D).seconds).toBe("30");
    expect(prefillRow(item({ planItemId: "d", metricType: "DISTANCE_TIME", targetDistanceMeters: 50 }), 1, [], M, D).meters).toBe("50");
    expect(prefillRow(item({ planItemId: "s", metricType: "SCORE", reps: 10 }), 1, [], M, D).outOf).toBe("10");
  });
  it("lays saved sets over the plan as ticked rows and keeps extra sets", () => {
    const it0 = item({ planItemId: "q", sets: 2 });
    const rows = buildRows(it0, { type: "single", rounds: 1 }, [], [saved({ setNumber: 1, weightKg: 45, reps: 7, setType: "warmup" }), saved({ setNumber: 3, weightKg: 50, reps: 5 })], M, D);
    expect(rows.map((r) => [r.setNumber, r.done, r.weight, r.setType])).toEqual([
      [1, true, "45", "warmup"],
      [2, false, "", "normal"],
      [3, true, "50", "normal"],
    ]);
  });
  it("gives the same set id for the same set, so retries converge", () => {
    const a = prefillRow(item({ planItemId: "q" }), 2, [], M, D).clientId;
    expect(a).toBe(prefillRow(item({ planItemId: "q" }), 2, [], M, D).clientId);
    expect(a).not.toBe(prefillRow(item({ planItemId: "q" }), 3, [], M, D).clientId);
    expect(a.length).toBeGreaterThanOrEqual(8);
    expect(a.length).toBeLessThanOrEqual(64);
  });
});

describe("rowToSet", () => {
  const base = prefillRow(item({ planItemId: "q" }), 1, [], M, D);
  it("builds a weight and reps set, accepts a decimal comma and needs reps", () => {
    expect(rowToSet("WEIGHT_REPS", { ...base, weight: "42,5", reps: "8" })).toMatchObject({ ok: true, set: { weightKg: 42.5, reps: 8, setType: "normal" } });
    expect(rowToSet("WEIGHT_REPS", { ...base, weight: "40", reps: "" })).toMatchObject({ ok: false, field: "reps" });
    expect(rowToSet("WEIGHT_REPS", { ...base, weight: "", reps: "12" })).toMatchObject({ ok: true }); // bodyweight
    expect(rowToSet("WEIGHT_REPS", { ...base, weight: "1001", reps: "1" })).toMatchObject({ ok: false, field: "weight" });
  });
  it("checks each metric's own fields", () => {
    expect(rowToSet("REPS", { ...base, reps: "0" })).toMatchObject({ ok: false });
    expect(rowToSet("TIME", { ...base, seconds: "45" })).toMatchObject({ ok: true, set: { seconds: 45 } });
    expect(rowToSet("DISTANCE_TIME", { ...base, meters: "50", seconds: "61" })).toMatchObject({ ok: true, set: { meters: 50, seconds: 61 } });
    expect(rowToSet("DISTANCE_TIME", { ...base, meters: "", seconds: "61" })).toMatchObject({ ok: false, field: "meters" });
    expect(rowToSet("SCORE", { ...base, made: "12", outOf: "20" })).toMatchObject({ ok: true, set: { scoreMade: 12, scoreOf: 20 } });
    expect(rowToSet("SCORE", { ...base, made: "21", outOf: "20" })).toMatchObject({ ok: false, problem: "scoreOrder" });
    expect(rowToSet("SCORE", { ...base, made: "", outOf: "20" })).toMatchObject({ ok: false, field: "made" });
    expect(rowToSet("CHECKLIST", base)).toMatchObject({ ok: true, set: { reps: 1 } });
  });
  it("parses numbers strictly", () => {
    expect(parseNum("12")).toBe(12);
    expect(parseNum(" 7.25 ")).toBe(7.25);
    expect(parseNum("")).toBeNull();
    expect(parseNum("-3")).toBeNull();
    expect(parseNum("1e3")).toBeNull();
  });
});

describe("order, focus, progress and rest", () => {
  it("works a superset round by round, then the next block", () => {
    const { blocks, rows } = plan();
    const order = executionOrder(blocks, rows).map((s) => `${s.itemKey.split(":")[1]}#${s.setNumber}`);
    expect(order).toEqual(["bench#1", "row#1", "bench#2", "row#2", "bench#3", "row#3", "squat#1", "squat#2"]);
  });
  it("moves focus from the first exercise of a round to the next exercise, then to the next round", () => {
    const { blocks, rows } = plan();
    const order = executionOrder(blocks, rows);
    const tickSet = (r: RowsByItem, key: string, n: number): RowsByItem => ({ ...r, [key]: r[key]!.map((x) => (x.setNumber === n ? { ...x, done: true } : x)) });
    let r = tickSet(rows, "a1:bench", 1);
    expect(nextOpenSlot(order, r, { itemKey: "a1:bench", setNumber: 1 })).toMatchObject({ itemKey: "a1:row", setNumber: 1 });
    r = tickSet(r, "a1:row", 1);
    expect(nextOpenSlot(order, r, { itemKey: "a1:row", setNumber: 1 })).toMatchObject({ itemKey: "a1:bench", setNumber: 2 });
  });
  it("skips sets that are already done and wraps to the first open one; null when all done", () => {
    const { blocks, rows } = plan();
    const order = executionOrder(blocks, rows);
    const all: RowsByItem = Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, v.map((x) => ({ ...x, done: true }))]));
    expect(nextOpenSlot(order, all, { itemKey: "a1:squat", setNumber: 2 })).toBeNull();
    const open = { ...all, "a1:bench": all["a1:bench"]!.map((x) => (x.setNumber === 1 ? { ...x, done: false } : x)) };
    expect(nextOpenSlot(order, open, { itemKey: "a1:squat", setNumber: 2 })).toMatchObject({ itemKey: "a1:bench", setNumber: 1 });
  });
  it("reports sets done of total and round x of y", () => {
    const { blocks, rows } = plan();
    expect(progressOf(blocks, rows)).toMatchObject({ done: 0, total: 8, percent: 0, current: { type: "superset", label: "A", round: 1, rounds: 3 } });
    const r2: RowsByItem = { ...rows, "a1:bench": rows["a1:bench"]!.map((x) => (x.setNumber <= 2 ? { ...x, done: true } : x)), "a1:row": rows["a1:row"]!.map((x) => (x.setNumber <= 1 ? { ...x, done: true } : x)) };
    const p = progressOf(blocks, r2);
    expect(p.done).toBe(3);
    expect(p.percent).toBe(38);
    expect(p.current).toMatchObject({ round: 2, exercise: 2 });
  });
  it("rests once per round of a superset (after the last exercise) and after every single set", () => {
    const { blocks, rows } = plan();
    const sup = blocks[0]!;
    expect(restAfterTick(sup, 0, 1, rows)).toBeNull(); // first exercise: the round is not done
    const benchDone: RowsByItem = { ...rows, "a1:bench": rows["a1:bench"]!.map((x) => (x.setNumber === 1 ? { ...x, done: true } : x)) };
    expect(restAfterTick(sup, 1, 1, benchDone)).toBe(60);
    expect(restAfterTick(blocks[1]!, 0, 1, rows)).toBe(45);
    expect(restAfterTick({ ...blocks[1]!, items: [{ ...blocks[1]!.items[0]!, restSeconds: null }] }, 0, 1, rows)).toBeNull();
  });
  it("totals sets, reps and volume; warm-ups are not counted in volume", () => {
    const { blocks, rows } = plan();
    const r: RowsByItem = {
      ...rows,
      "a1:bench": [
        { ...rows["a1:bench"]![0]!, done: true, weight: "20", reps: "10", setType: "warmup" },
        { ...rows["a1:bench"]![1]!, done: true, weight: "40", reps: "8" },
        rows["a1:bench"]![2]!,
      ],
    };
    const tot = totalsOf(blocks, r);
    expect(tot).toMatchObject({ setsDone: 2, setsPlanned: 8, exercises: 1, reps: 8, volumeKg: 320 });
  });
  it("formats a clock", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(75)).toBe("1:15");
    expect(formatClock(3725)).toBe("1:02:05");
  });
});

describe("format", () => {
  it("shows last time per metric", () => {
    expect(formatLast("WEIGHT_REPS", [saved({ setNumber: 1, weightKg: 40, reps: 8 }), saved({ setNumber: 2, weightKg: 42.5, reps: 6 })], t)).toBe("40 kg × 8 · 42.5 kg × 6");
    expect(formatLast("DISTANCE_TIME", [saved({ setNumber: 1, meters: 50, seconds: 61 })], t)).toBe("50 m, 61 s");
    expect(formatLast("SCORE", [saved({ setNumber: 1, scoreMade: 12, scoreOf: 20 })], t)).toBe("12/20");
    expect(formatLast("TIME", [], t)).toBeNull();
  });
  it("shows targets: a superset item has no sets; a score drill reads attempts", () => {
    const sup = item({ planItemId: "a", targetWeightKg: 40, supersetGroup: "A", rounds: 3 });
    expect(formatTargets(sup, true, t, "en")).toEqual(["8 reps", "40 kg"]);
    expect(formatTargets(item({ planItemId: "b" }), false, t, "en")[0]).toBe("3 sets × 8 reps");
    expect(formatTargets(item({ planItemId: "c", metricType: "SCORE", reps: 10, sets: 1 }), false, t, "en").join(" ")).toContain("10");
  });
  it("formats record values with units", () => {
    expect(formatBestValue("heaviest_weight", 90, t)).toBe("90 kg");
    expect(formatBestValue("best_split", 95.5, t)).toBe("95.5 s per 100 m");
    expect(formatBestValue("best_score", 60, t)).toBe("60%");
  });
});
