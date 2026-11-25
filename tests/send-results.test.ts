import { describe, expect, it } from "vitest";
import { translate } from "../lib/i18n";
import { bestKey, buildAssignmentView, formatBest, formatSet, parseRange, setsText, sortByName, type ResultAssignment, type ResultSet } from "../lib/send/results";

const t = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) => translate("en", key, params);
const set = (o: Partial<ResultSet> = {}): ResultSet => ({ id: `s${Math.random()}`, setNumber: 1, setType: "normal", weightKg: null, reps: null, seconds: null, meters: null, scoreMade: null, scoreOf: null, rating: null, ...o });

describe("formatting one set", () => {
  it("reads weight and reps, reps, time, distance, score and coach check", () => {
    expect(formatSet(set({ weightKg: 22, reps: 10 }), t)).toBe("22 kg × 10");
    expect(formatSet(set({ weightKg: 22.5, reps: 8 }), t)).toBe("22.5 kg × 8");
    expect(formatSet(set({ reps: 12 }), t)).toBe("12 reps");
    expect(formatSet(set({ seconds: 45 }), t)).toBe("45 sec");
    expect(formatSet(set({ meters: 50, seconds: 61 }), t)).toBe("50 m in 61 sec");
    expect(formatSet(set({ scoreMade: 12, scoreOf: 20 }), t)).toBe("12 of 20");
    expect(formatSet(set({ rating: 3 }), t)).toBe("Coach check 3 of 4");
  });
  it("formats records with their unit", () => {
    expect(formatBest("heaviest_weight", 22)).toBe("22 kg");
    expect(formatBest("best_score", 60)).toBe("60%");
    expect(formatBest("longest_time", 90)).toBe("90 s");
    expect(bestKey("heaviest_weight")).toBe("we.best.heaviest_weight");
    expect(bestKey("nonsense")).toBe("we.best.heaviest_weight");
  });
});

const log = (o: Record<string, unknown>) => ({ logId: "l", planItemId: "i1", exerciseId: "e1", exerciseName: "Row", metricType: "WEIGHT_REPS", status: "completed", note: null, actualSets: null, sets: [], newBests: [], ...o });
const assignment = (days: ResultAssignment["days"], o: Partial<ResultAssignment> = {}): ResultAssignment => ({
  assignmentId: "a1", memberId: "m1", memberName: "Aarav Sharma", status: "active", startsOn: "2026-11-01", endsOn: null, note: null,
  itemsCompleted: 0, itemsSkipped: 0, daysLogged: days.length, setCount: 0, newBestCount: 0, days, ...o,
});
const plan = { days: [{ items: [
  { id: "i1", sets: 3, rounds: 3, supersetGroup: "A" },
  { id: "i2", sets: 3, rounds: 3, supersetGroup: "A" },
  { id: "i3", sets: 2, rounds: null, supersetGroup: null },
] }] };

describe("results view for one assignment", () => {
  const a = assignment([
    { date: "2026-11-24", items: [
      log({ logId: "l1", planItemId: "i1", exerciseName: "Bench", sets: [set({ id: "a", setNumber: 1, weightKg: 20, reps: 10, setType: "warmup" }), set({ id: "b", setNumber: 2, weightKg: 22, reps: 10 }), set({ id: "c", setNumber: 3, weightKg: 22, reps: 10 })], newBests: [{ metric: "heaviest_weight", value: 22, previous: 20 }], note: "Felt strong" }),
      log({ logId: "l2", planItemId: "i2", exerciseName: "Row", sets: [set({ id: "d", setNumber: 1, weightKg: 30, reps: 10 })], note: "Felt strong" }),
      log({ logId: "l3", planItemId: "i3", exerciseName: "Plank", sets: [set({ id: "e", setNumber: 1, seconds: 45 }), set({ id: "f", setNumber: 2, seconds: 45 })] }),
    ] },
  ], { newBestCount: 1 });
  const v = buildAssignmentView(a, plan, t);

  it("shows a superset as one block with its rounds and the single exercise as its own", () => {
    const blocks = v.days[0]!.blocks;
    expect(blocks.map((b) => b.type)).toEqual(["superset", "single"]);
    expect(blocks[0]!.label).toBe("A");
    expect(blocks[0]!.rounds).toBe(3);
    expect(blocks[0]!.items.map((i) => i.name)).toEqual(["Bench", "Row"]);
  });
  it("labels warm-up sets and keeps the set values readable", () => {
    const first = v.days[0]!.blocks[0]!.items[0]!.sets;
    expect(first[0]).toMatchObject({ warmup: true, typeLabel: "Warm-up", value: "20 kg × 10" });
    expect(first[1]).toMatchObject({ warmup: false, typeLabel: null, value: "22 kg × 10" });
  });
  it("counts work sets against the plan, leaving warm-ups out", () => {
    // Bench: 2 work sets of 3 rounds, Row: 1 of 3, Plank: 2 of 2
    expect(v.setsDone).toBe(5);
    expect(v.setsPlanned).toBe(8);
    expect(setsText(v, t)).toBe("5 of 8 sets");
  });
  it("is completed only when everything logged is completed, and carries notes once", () => {
    expect(v.badge).toBe("completed");
    expect(v.notes).toEqual(["Felt strong"]);
    expect(v.newBestCount).toBe(1);
    const partial = buildAssignmentView(assignment([{ date: "2026-11-24", items: [log({ status: "skipped" })] }]), plan, t);
    expect(partial.badge).toBe("inProgress");
  });
  it("is not started yet (never a failure) when nothing is logged", () => {
    const none = buildAssignmentView(assignment([]), plan, t);
    expect(none.badge).toBe("notStarted");
    expect(setsText(none, t)).toBe("0 sets");
  });
  it("marks paused and ended assignments without changing the logged view", () => {
    expect(buildAssignmentView(assignment([], { status: "paused" }), plan, t).paused).toBe(true);
    expect(buildAssignmentView(assignment([], { status: "ended" }), plan, t).ended).toBe(true);
  });
  it("works without the plan (planned sets unknown) and falls back to logged sets", () => {
    const nop = buildAssignmentView(a, null, t);
    expect(nop.setsPlanned).toBe(0);
    expect(setsText(nop, t)).toBe("5 sets");
  });
});

describe("listing members", () => {
  it("sorts by name so no one is ranked", () => {
    expect(sortByName([{ memberName: "Zoya" }, { memberName: "aarav" }, { memberName: "Diya" }]).map((x) => x.memberName)).toEqual(["aarav", "Diya", "Zoya"]);
  });
  it("accepts only the offered ranges", () => {
    expect(parseRange("7")).toBe(7);
    expect(parseRange(["90"])).toBe(90);
    expect(parseRange("5")).toBe(28);
    expect(parseRange(undefined)).toBe(28);
  });
});
