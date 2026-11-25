import { describe, expect, it } from "vitest";
import {
  buildRecords,
  buildSeries,
  deriveLogTotals,
  epley1RM,
  findNewBests,
  rangeStart,
  scoreRatio,
  sessionMetrics,
  setVolume,
  splitPer100m,
  type HistorySession,
  type SetLike,
} from "../lib/workouts/records";
import { expandPlanDay, groupIntoBlocks, validateSupersets } from "../lib/workouts/supersets";
import { QUIET_FILL_BELOW, isQuietSlot, slotRates, suggest } from "../lib/analytics/class-insights";

const set = (p: Partial<SetLike> = {}): SetLike => ({ setType: "NORMAL", weightKg: null, reps: null, seconds: null, meters: null, scoreMade: null, scoreOf: null, ...p });
const sess = (logId: string, date: string, sets: Partial<SetLike>[]): HistorySession => ({ logId, date, sets: sets.map(set) });

describe("records: single-set maths", () => {
  it("Epley one-rep max: w * (1 + reps / 30), one rep is the weight itself", () => {
    expect(epley1RM(100, 1)).toBe(100);
    expect(epley1RM(100, 10)).toBe(133.33);
    expect(epley1RM(60, 5)).toBe(70);
    expect(epley1RM(0, 5)).toBe(0);
    expect(epley1RM(50, 0)).toBe(0);
  });
  it("set volume, split per 100 m and score ratio", () => {
    expect(setVolume(set({ weightKg: 20, reps: 10 }))).toBe(200);
    expect(setVolume(set({ weightKg: 20 }))).toBe(0);
    expect(splitPer100m(set({ meters: 50, seconds: 60 }))).toBe(120);
    expect(splitPer100m(set({ meters: 0, seconds: 60 }))).toBeNull();
    expect(splitPer100m(set({ meters: 50 }))).toBeNull();
    expect(scoreRatio(set({ scoreMade: 15, scoreOf: 20 }))).toBe(75);
    expect(scoreRatio(set({ scoreMade: 0, scoreOf: 10 }))).toBe(0);
    expect(scoreRatio(set({ scoreOf: 10 }))).toBeNull();
  });
});

describe("records: gym (weight and reps)", () => {
  const history = [
    sess("a", "2026-09-01", [{ setType: "WARMUP", weightKg: 100, reps: 10 }, { weightKg: 60, reps: 8 }, { weightKg: 60, reps: 8 }, { weightKg: 65, reps: 5 }]),
    sess("b", "2026-10-01", [{ weightKg: 65, reps: 8 }, { weightKg: 70, reps: 5 }]),
    sess("c", "2026-11-01", [{ weightKg: 70, reps: 6 }, { weightKg: 60, reps: 12, setType: "DROP" }]),
  ];

  it("session metrics ignore warm-up sets", () => {
    const m = sessionMetrics(history[0]);
    expect(m.heaviestWeight).toBe(65); // not the 100 kg warm-up
    expect(m.totalReps).toBe(21);
    expect(m.sessionVolume).toBe(60 * 8 + 60 * 8 + 65 * 5);
    expect(m.bestSetVolume).toBe(480);
    expect(m.oneRepMax).toBe(76.0); // 60 x 8 = 76; 65 x 5 = 75.83
    expect(m.bestTime).toBeNull();
    expect(m.bestSplit).toBeNull();
    expect(m.bestScore).toBeNull();
  });

  it("series: one point per session per metric, oldest first, even when given newest first", () => {
    const s = buildSeries([...history].reverse());
    expect(s.heaviestWeight).toEqual([{ date: "2026-09-01", value: 65 }, { date: "2026-10-01", value: 70 }, { date: "2026-11-01", value: 70 }]);
    expect(s.totalReps.map((p) => p.value)).toEqual([21, 13, 18]);
    expect(s.sessionVolume.map((p) => p.value)).toEqual([1285, 870, 1140]);
    expect(s.bestSetVolume.map((p) => p.value)).toEqual([480, 520, 720]);
    expect(s.bestTime).toEqual([]);
    expect(s.bestSplit).toEqual([]);
    expect(s.bestScore).toEqual([]);
  });

  it("records: heaviest, estimated max, best volumes, most reps and best weight at each rep count", () => {
    const r = buildRecords(history);
    expect(r.heaviestWeight).toEqual({ value: 70, date: "2026-10-01" }); // first date the value was reached
    expect(r.oneRepMax?.date).toBe("2026-11-01"); // 60 x 12 = 84
    expect(r.oneRepMax?.value).toBe(84);
    expect(r.bestSetVolume).toEqual({ value: 720, date: "2026-11-01" });
    expect(r.bestSessionVolume).toEqual({ value: 1285, date: "2026-09-01" });
    expect(r.mostReps).toEqual({ value: 12, date: "2026-11-01" });
    expect(r.weightAtReps).toEqual([
      { reps: 5, weightKg: 70, date: "2026-10-01" },
      { reps: 6, weightKg: 70, date: "2026-11-01" },
      { reps: 8, weightKg: 65, date: "2026-10-01" },
      { reps: 12, weightKg: 60, date: "2026-11-01" },
    ]);
    expect(r.longestTime).toBeNull();
    expect(r.bestSplit).toBeNull();
    expect(r.bestScore).toBeNull();
  });

  it("an empty history gives empty series and null records", () => {
    const s = buildSeries([]);
    for (const v of Object.values(s)) expect(v).toEqual([]);
    const r = buildRecords([]);
    expect(r.heaviestWeight).toBeNull();
    expect(r.weightAtReps).toEqual([]);
  });
});

describe("records: time, distance and score", () => {
  it("time: longest single set (holds, drills)", () => {
    const h = [sess("a", "2026-10-01", [{ seconds: 40 }, { seconds: 45 }]), sess("b", "2026-10-08", [{ seconds: 50 }, { seconds: 30 }])];
    expect(buildSeries(h).bestTime).toEqual([{ date: "2026-10-01", value: 45 }, { date: "2026-10-08", value: 50 }]);
    expect(buildRecords(h).longestTime).toEqual({ value: 50, date: "2026-10-08" });
  });
  it("distance and time: best split is the lowest seconds per 100 m", () => {
    const h = [sess("a", "2026-10-01", [{ meters: 50, seconds: 70 }, { meters: 50, seconds: 66 }]), sess("b", "2026-10-08", [{ meters: 100, seconds: 120 }])];
    const s = buildSeries(h);
    expect(s.bestSplit).toEqual([{ date: "2026-10-01", value: 132 }, { date: "2026-10-08", value: 120 }]);
    expect(buildRecords(h).bestSplit).toEqual({ value: 120, date: "2026-10-08" });
    expect(s.heaviestWeight).toEqual([]);
  });
  it("score: best made-out-of ratio as a percent", () => {
    const h = [sess("a", "2026-10-01", [{ scoreMade: 10, scoreOf: 20 }, { scoreMade: 12, scoreOf: 20 }]), sess("b", "2026-10-08", [{ scoreMade: 7, scoreOf: 10 }])];
    expect(buildSeries(h).bestScore).toEqual([{ date: "2026-10-01", value: 60 }, { date: "2026-10-08", value: 70 }]);
    expect(buildRecords(h).bestScore).toEqual({ value: 70, date: "2026-10-08" });
  });
  it("reps only (karate, calisthenics): total reps and most reps", () => {
    const h = [sess("a", "2026-10-01", [{ reps: 10 }, { reps: 12 }]), sess("b", "2026-10-02", [{ reps: 15 }])];
    expect(buildSeries(h).totalReps.map((p) => p.value)).toEqual([22, 15]);
    expect(buildRecords(h).mostReps).toEqual({ value: 15, date: "2026-10-02" });
  });
  it("checklist ratings are kept on the set and never become a record", () => {
    const h = [sess("a", "2026-10-01", [{ reps: 1 }])];
    expect(sessionMetrics(h[0]).bestScore).toBeNull();
  });
});

describe("records: new bests", () => {
  const h = [
    sess("a", "2026-09-01", [{ weightKg: 60, reps: 8 }]),
    sess("b", "2026-09-08", [{ weightKg: 60, reps: 8 }]),
    sess("c", "2026-09-15", [{ weightKg: 65, reps: 8 }]),
  ];
  it("the first session is a baseline, later sessions must beat the best so far", () => {
    const nb = findNewBests(h);
    expect(nb.filter((n) => n.logId === "a")).toEqual([]);
    expect(nb.filter((n) => n.logId === "b")).toEqual([]);
    const c = nb.filter((n) => n.logId === "c").map((n) => n.metric).sort();
    expect(c).toEqual(["best_set_volume", "heaviest_weight", "one_rep_max", "session_volume"].sort());
    expect(nb.find((n) => n.logId === "c" && n.metric === "heaviest_weight")).toMatchObject({ value: 65, previous: 60 });
  });
  it("can be limited to some sessions while still reading the whole history", () => {
    expect(findNewBests(h, new Set(["b"]))).toEqual([]);
    expect(findNewBests(h, new Set(["c"])).length).toBeGreaterThan(0);
  });
  it("a lower split is better", () => {
    const s = [sess("a", "2026-10-01", [{ meters: 50, seconds: 70 }]), sess("b", "2026-10-08", [{ meters: 50, seconds: 64 }])];
    expect(findNewBests(s).find((n) => n.metric === "best_split")).toMatchObject({ logId: "b", value: 128, previous: 140 });
  });
});

describe("records: log totals and ranges", () => {
  it("totals come from work sets, warm-ups are left out", () => {
    const t = deriveLogTotals([set({ setType: "WARMUP", reps: 10 }), set({ reps: 8 }), set({ reps: 7, seconds: 30 })]);
    expect(t).toEqual({ actualSets: 2, actualReps: 15, actualDurationSeconds: 30 });
    expect(deriveLogTotals([set({ reps: 5 })]).actualDurationSeconds).toBeNull();
  });
  it("range starts", () => {
    expect(rangeStart("3m", "2026-11-25")).toBe("2026-08-25");
    expect(rangeStart("1y", "2026-11-25")).toBe("2025-11-25");
    expect(rangeStart("all", "2026-11-25")).toBeNull();
  });
});

describe("supersets: validation", () => {
  const item = (position: number, supersetGroup: string | null = null, rounds: number | null = null) => ({ position, supersetGroup, rounds });
  it("accepts a contiguous group of two or more with the same rounds", () => {
    expect(validateSupersets([item(1), item(2, "A", 3), item(3, "A", 3), item(4)])).toEqual([]);
    expect(validateSupersets([item(1, "A", 2), item(2, "A", 2), item(3, "A", 2)])).toEqual([]);
    expect(validateSupersets([item(1, "A"), item(2, "A")])).toEqual([]); // rounds optional, but equal
  });
  it("a group needs 2 or more items", () => {
    expect(validateSupersets([item(1, "A", 3), item(2)])).toEqual([{ index: 0, field: "supersetGroup", message: "Group A needs at least 2 items" }]);
  });
  it("group items must be next to each other, checked in position order", () => {
    const p = validateSupersets([item(1, "A", 3), item(2), item(3, "A", 3)]);
    expect(p.map((x) => x.index).sort()).toEqual([0, 2]);
    // The same items given out of order are still fine when positions are contiguous.
    expect(validateSupersets([item(3), item(2, "A", 3), item(1, "A", 3)])).toEqual([]);
  });
  it("rounds must match inside a group and need a group", () => {
    expect(validateSupersets([item(1, "A", 3), item(2, "A", 4)]).map((x) => x.field)).toEqual(["rounds", "rounds"]);
    expect(validateSupersets([item(1, "A", 3), item(2, "A", null)]).length).toBe(2);
    expect(validateSupersets([item(1, null, 3), item(2)])).toEqual([{ index: 0, field: "rounds", message: "rounds needs a supersetGroup" }]);
  });
  it("labels are 1 to 4 letters or digits; two groups can sit side by side", () => {
    expect(validateSupersets([item(1, "bad label", 2), item(2, "bad label", 2)]).length).toBe(2);
    expect(validateSupersets([item(1, "A", 2), item(2, "A", 2), item(3, "B", 3), item(4, "B", 3)])).toEqual([]);
  });
});

describe("supersets: block expansion", () => {
  type It = { id: string; position: number; supersetGroup?: string | null; rounds?: number | null };
  const items: It[] = [
    { id: "1", position: 1 },
    { id: "2", position: 2, supersetGroup: "A", rounds: 3 },
    { id: "3", position: 3, supersetGroup: "A", rounds: 3 },
    { id: "4", position: 4, supersetGroup: "B", rounds: 2 },
    { id: "5", position: 5, supersetGroup: "B", rounds: 2 },
    { id: "6", position: 6 },
  ];
  it("groups a day into single and superset blocks in position order", () => {
    const blocks = expandPlanDay([...items].reverse());
    expect(blocks.map((b) => [b.type, b.label, b.rounds, b.items.map((i) => i.id)])).toEqual([
      ["single", null, null, ["1"]],
      ["superset", "A", 3, ["2", "3"]],
      ["superset", "B", 2, ["4", "5"]],
      ["single", null, null, ["6"]],
    ]);
  });
  it("a lone labelled item renders as a single, and scopes keep different assignments apart", () => {
    expect(groupIntoBlocks([{ supersetGroup: "A", rounds: 3 }]).map((b) => b.type)).toEqual(["single"]);
    const mixed = [
      { id: "a1", supersetGroup: "A", rounds: 2, scope: "x" },
      { id: "a2", supersetGroup: "A", rounds: 2, scope: "y" },
    ];
    expect(groupIntoBlocks(mixed, (i) => i.scope).map((b) => b.type)).toEqual(["single", "single"]);
    expect(groupIntoBlocks(mixed).map((b) => b.type)).toEqual(["superset"]);
  });
});

describe("class insights: pure rules", () => {
  const facts = (n: number, present: number, capacity: number | null, workout = false) =>
    Array.from({ length: n }, () => ({ status: "COMPLETED", capacity, present, absent: 1, hasWorkout: workout }));

  it("rates over held sessions only", () => {
    const r = slotRates([...facts(4, 5, 10, true), { status: "SCHEDULED", capacity: 10, present: 0, absent: 0, hasWorkout: false }]);
    expect(r).toEqual({ sessionCount: 4, avgFillRate: 50, attendanceRate: 83.3, workoutSentShare: 100 });
    expect(slotRates([])).toEqual({ sessionCount: 0, avgFillRate: null, attendanceRate: null, workoutSentShare: null });
    expect(slotRates(facts(2, 3, null)).avgFillRate).toBeNull();
    expect(slotRates(facts(1, 30, 10)).avgFillRate).toBe(100); // never above full
  });
  it("a quiet slot needs 3 classes and a fill under the threshold", () => {
    expect(isQuietSlot({ sessionCount: 3, avgFillRate: QUIET_FILL_BELOW - 1 })).toBe(true);
    expect(isQuietSlot({ sessionCount: 3, avgFillRate: QUIET_FILL_BELOW })).toBe(false);
    expect(isQuietSlot({ sessionCount: 2, avgFillRate: 10 })).toBe(false);
    expect(isQuietSlot({ sessionCount: 5, avgFillRate: null })).toBe(false);
  });
  it("suggests adding a class where the waitlist is long, and moving a quiet slot toward demand", () => {
    const slots = [
      { batchId: "b1", batchName: "Evening", sportId: "s1", sessionCount: 8, avgFillRate: 95, waitlistCount: 5 },
      { batchId: "b2", batchName: "Morning", sportId: "s1", sessionCount: 8, avgFillRate: 20, waitlistCount: 0 },
      { batchId: "b3", batchName: "Noon", sportId: "s2", sessionCount: 8, avgFillRate: 10, waitlistCount: 0 },
      { batchId: "b4", batchName: "Late", sportId: "s1", sessionCount: 8, avgFillRate: 70, waitlistCount: 2 },
    ];
    const out = suggest(slots);
    expect(out.map((s) => [s.kind, s.batchId, s.messageKey])).toEqual([
      ["add_class", "b1", "ci.addClass"],
      ["move_slot", "b2", "ci.moveSlot"], // Noon is quiet too but no other slot of its sport has demand
    ]);
    expect(out[0].params).toEqual({ batchName: "Evening", waitlistCount: 5 });
    expect(out[1].params).toEqual({ batchName: "Morning", targetBatchName: "Evening", waitlistCount: 5 });
  });
  it("suggestions never carry coach information", () => {
    const out = suggest([{ batchId: "b1", batchName: "Evening", sportId: "s1", sessionCount: 8, avgFillRate: 95, waitlistCount: 5 }]);
    expect(JSON.stringify(out)).not.toMatch(/coach/i);
  });
});
