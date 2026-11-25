import { describe, expect, it } from "vitest";
import { buildPayload, emptyForm, emptyItem, formFromPlan, updateDay, validateForm, type ItemForm, type PlanForm } from "../lib/plans/form";
import {
  canMove,
  canMoveBlock,
  formBlocks,
  groupSelected,
  leaveGroup,
  moveBlock,
  moveItemSmart,
  nextLabel,
  normalizeGroups,
  removeItem,
  setGroupRest,
  setGroupRounds,
  ungroup,
} from "../lib/plans/supersets-form";
import { validateSupersets } from "../lib/workouts/supersets";

const mk = (name: string, metricType = "WEIGHT_REPS"): ItemForm => ({ ...emptyItem({ id: `id-${name}`, name, metricType }), key: `k-${name}` });
const names = (items: ItemForm[]) => items.map((i) => `${i.exerciseName}${i.supersetGroup ? `(${i.supersetGroup})` : ""}`);
const sel = (...n: string[]) => new Set(n.map((x) => `k-${x}`));
/** The API's own rule: valid when validateSupersets finds nothing. */
const valid = (items: ItemForm[]) => validateSupersets(items.map((it, i) => ({ position: i + 1, supersetGroup: it.supersetGroup || null, rounds: it.rounds ? Number(it.rounds) : null }))).length === 0;

describe("groupSelected", () => {
  it("groups two or more with the next label, shared rounds and rest", () => {
    const items = [mk("a"), mk("b"), mk("c")];
    items[1]!.restSeconds = "90";
    const res = groupSelected(items, sel("a", "b"))!;
    expect(res.label).toBe("A");
    expect(res.count).toBe(2);
    expect(names(res.items)).toEqual(["a(A)", "b(A)", "c"]);
    expect(res.items.slice(0, 2).map((i) => [i.rounds, i.sets, i.restSeconds])).toEqual([["3", "3", "90"], ["3", "3", "90"]]);
    expect(valid(res.items)).toBe(true);
  });
  it("needs two; one or none gives null", () => {
    expect(groupSelected([mk("a"), mk("b")], sel("a"))).toBeNull();
    expect(groupSelected([mk("a"), mk("b")], sel())).toBeNull();
  });
  it("brings apart items together at the first one, keeping the rest in order", () => {
    const res = groupSelected([mk("a"), mk("b"), mk("c"), mk("d")], sel("b", "d"))!;
    expect(names(res.items)).toEqual(["a", "b(A)", "d(A)", "c"]);
    expect(valid(res.items)).toBe(true);
  });
  it("uses the next free label and never lands inside another group", () => {
    const first = groupSelected([mk("a"), mk("b"), mk("c"), mk("d"), mk("e")], sel("a", "b"))!;
    const second = groupSelected(first.items, sel("c", "d"))!;
    expect(second.label).toBe("B");
    expect(names(second.items)).toEqual(["a(A)", "b(A)", "c(B)", "d(B)", "e"]);
    // Pull the middle of group A out into a new group: A (two left) stays in one piece.
    const three = groupSelected([mk("a"), mk("b"), mk("c"), mk("d")], sel("a", "b", "c"))!;
    const split = groupSelected(three.items, sel("b", "d"))!;
    expect(valid(split.items)).toBe(true);
    expect(nextLabel(split.items)).toBe("C");
  });
  it("dissolves an old group that is left with one exercise", () => {
    const g = groupSelected([mk("a"), mk("b"), mk("c")], sel("a", "b"))!;
    const res = groupSelected(g.items, sel("b", "c"))!;
    expect(names(res.items)).toEqual(["a", "b(B)", "c(B)"].map((n) => n)); // a falls back to single
    expect(res.items[0]!.supersetGroup).toBe("");
    expect(valid(res.items)).toBe(true);
  });
  it("starts rounds from the most sets any of them had", () => {
    const items = [mk("a"), mk("b")];
    items[0]!.sets = "5";
    expect(groupSelected(items, sel("a", "b"))!.items[0]!.rounds).toBe("5");
    expect(groupSelected(items, sel("a", "b"), { rounds: 99 })!.items[0]!.rounds).toBe("20");
  });
});

describe("editing groups", () => {
  const grouped = () => groupSelected([mk("a"), mk("b"), mk("c")], sel("a", "b"))!.items;
  it("ungroups, and sets rounds and rest for the whole group", () => {
    expect(names(ungroup(grouped(), "A"))).toEqual(["a", "b", "c"]);
    const r = setGroupRounds(grouped(), "A", "4");
    expect(r.slice(0, 2).map((i) => [i.rounds, i.sets])).toEqual([["4", "4"], ["4", "4"]]);
    expect(setGroupRest(grouped(), "A", "75").slice(0, 2).map((i) => i.restSeconds)).toEqual(["75", "75"]);
    expect(setGroupRest(grouped(), "A", "75")[2]!.restSeconds).toBe("60");
  });
  it("moves a block as a whole and never splits a group", () => {
    const g = grouped();
    expect(names(moveBlock(g, "k-a", 1))).toEqual(["c", "a(A)", "b(A)"]);
    expect(names(moveBlock(moveBlock(g, "k-a", 1), "k-a", -1))).toEqual(["a(A)", "b(A)", "c"]);
    expect(names(moveBlock(g, "k-a", -1))).toEqual(["a(A)", "b(A)", "c"]); // top: no move
    expect(canMoveBlock(g, "k-a", -1)).toBe(false);
    expect(canMoveBlock(g, "k-a", 1)).toBe(true);
  });
  it("moves a single item past a whole group in one step; inside a group it stays inside", () => {
    const g = grouped();
    expect(names(moveItemSmart(g, "k-c", -1))).toEqual(["c", "a(A)", "b(A)"]);
    expect(names(moveItemSmart(g, "k-b", -1))).toEqual(["b(A)", "a(A)", "c"]);
    expect(names(moveItemSmart(g, "k-b", 1))).toEqual(["a(A)", "b(A)", "c"]); // end of the group: stays
    expect(canMove(g, "k-b", 1)).toBe(false);
    expect(canMove(g, "k-c", -1)).toBe(true);
    for (const key of ["k-a", "k-b", "k-c"]) for (const d of [-1, 1] as const) expect(valid(moveItemSmart(g, key, d))).toBe(true);
  });
  it("takes an exercise out of a group (a middle one goes after it) and a one-left group falls apart", () => {
    const three = groupSelected([mk("a"), mk("b"), mk("c")], sel("a", "b", "c"))!.items;
    const out = leaveGroup(three, "k-b");
    expect(names(out)).toEqual(["a(A)", "c(A)", "b"]);
    expect(valid(out)).toBe(true);
    expect(names(leaveGroup(grouped(), "k-a"))).toEqual(["b", "a", "c"].map((n) => n));
    expect(leaveGroup(grouped(), "k-a").every((i) => i.supersetGroup === "")).toBe(true);
  });
  it("removing an exercise from a pair ungroups the other; normalizeGroups fixes lone labels", () => {
    expect(removeItem(grouped(), "k-a").every((i) => i.supersetGroup === "")).toBe(true);
    const lone = [{ ...mk("a"), supersetGroup: "A", rounds: "3" }, mk("b")];
    expect(normalizeGroups(lone)[0]).toMatchObject({ supersetGroup: "", rounds: "" });
  });
  it("lists blocks in order", () => {
    expect(formBlocks(grouped()).map((b) => [b.type, b.items.length])).toEqual([["superset", 2], ["single", 1]]);
  });
});

describe("form fields by metric type", () => {
  it("starts with targets that suit the metric", () => {
    expect(mk("w", "WEIGHT_REPS")).toMatchObject({ sets: "3", reps: "10", durationSeconds: "" });
    expect(mk("t", "TIME")).toMatchObject({ reps: "", durationSeconds: "30" });
    expect(mk("d", "DISTANCE_TIME")).toMatchObject({ sets: "4", targetDistanceMeters: "50", reps: "" });
    expect(mk("s", "SCORE")).toMatchObject({ reps: "10" });
    expect(mk("c", "CHECKLIST")).toMatchObject({ sets: "1", reps: "1" });
    expect(mk("x", "weird").metricType).toBe("WEIGHT_REPS");
  });
  function formWith(items: ItemForm[]): PlanForm {
    let f = emptyForm();
    f.title = "P";
    f = updateDay(f, f.days[0]!.key, (d) => ({ ...d, items }));
    return f;
  }
  it("accepts a distance-only item and rejects an item with no target at all", () => {
    const f = formWith([mk("d", "DISTANCE_TIME")]);
    expect(validateForm(f, "active")).toEqual([]);
    f.days[0]!.items[0]!.targetDistanceMeters = "";
    expect(validateForm(f, "draft")).toContainEqual({ path: "days[0].items[0]", code: "measure" });
  });
  it("checks target weight, distance and rounds", () => {
    const f = formWith([mk("a"), mk("b")]);
    f.days[0]!.items[0]!.targetWeightKg = "0";
    f.days[0]!.items[1]!.targetWeightKg = "42.5";
    expect(validateForm(f, "draft")).toContainEqual({ path: "days[0].items[0].targetWeightKg", code: "weight" });
    f.days[0]!.items[0]!.targetWeightKg = "40";
    expect(validateForm(f, "draft")).toEqual([]);
    f.days[0]!.items = groupSelected(f.days[0]!.items, sel("a", "b"))!.items;
    f.days[0]!.items[0]!.rounds = "21";
    expect(validateForm(f, "draft").map((e) => e.path)).toContain("days[0].items[0].rounds");
  });
  it("flags a split or mismatched superset with the API's rules", () => {
    const f = formWith([mk("a"), mk("b"), mk("c")]);
    f.days[0]!.items[0]!.supersetGroup = "A";
    f.days[0]!.items[2]!.supersetGroup = "A";
    expect(validateForm(f, "draft").some((e) => e.code === "group")).toBe(true);
    const g = formWith(groupSelected([mk("a"), mk("b")], sel("a", "b"))!.items);
    g.days[0]!.items[1]!.rounds = "5";
    expect(validateForm(g, "draft").some((e) => e.code === "group")).toBe(true);
  });
  it("builds the payload with the new fields only when set, and reads them back from a saved plan", () => {
    const f = formWith(groupSelected([mk("a"), mk("b"), mk("c", "DISTANCE_TIME")], sel("a", "b"))!.items);
    f.days[0]!.items[0]!.targetWeightKg = "42,5";
    const items = buildPayload(f, "active").days[0]!.items;
    expect(items[0]).toMatchObject({ supersetGroup: "A", rounds: 3, sets: 3, targetWeightKg: 42.5, position: 1 });
    expect(items[2]).toMatchObject({ targetDistanceMeters: 50, position: 3 });
    expect("supersetGroup" in items[2]!).toBe(false);
    expect("rounds" in items[2]!).toBe(false);
    const back = formFromPlan({
      title: "P",
      description: null,
      cadence: "weekly",
      sportSlug: null,
      days: [{ dayIndex: 1, title: null, notes: null, items: [{ exerciseId: "e", exerciseName: "n", sets: 3, reps: 8, durationSeconds: null, restSeconds: 60, notes: null, metricType: "WEIGHT_REPS", supersetGroup: "B", rounds: 4, targetWeightKg: 40, targetDistanceMeters: null }] }],
    });
    expect(back.days[0]!.items[0]).toMatchObject({ supersetGroup: "B", rounds: "4", targetWeightKg: "40", metricType: "WEIGHT_REPS" });
  });
});
