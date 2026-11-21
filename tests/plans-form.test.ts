import { describe, expect, it } from "vitest";
import {
  addDay,
  buildPayload,
  changeCadence,
  emptyForm,
  emptyItem,
  formFromPlan,
  freeDayIndexes,
  moveItem,
  setDayIndex,
  todayInTenantZone,
  updateDay,
  validateAssign,
  validateForm,
  type PlanForm,
} from "../lib/plans/form";

function filled(): PlanForm {
  let f = emptyForm();
  f.title = "  Strength A  ";
  f = updateDay(f, f.days[0].key, (d) => ({ ...d, items: [emptyItem({ id: "e1", name: "Squat" }), emptyItem({ id: "e2", name: "Plank" })] }));
  return f;
}

describe("validateForm", () => {
  it("accepts a filled plan", () => {
    expect(validateForm(filled(), "active")).toEqual([]);
  });
  it("requires a title", () => {
    const f = filled();
    f.title = "   ";
    expect(validateForm(f, "draft")).toContainEqual({ path: "title", code: "required" });
  });
  it("limits title and description length", () => {
    const f = filled();
    f.title = "x".repeat(81);
    f.description = "y".repeat(1001);
    const codes = validateForm(f, "draft").map((e) => `${e.path}:${e.code}`);
    expect(codes).toEqual(expect.arrayContaining(["title:tooLong", "description:tooLong"]));
  });
  it("checks set, rep, duration and rest ranges", () => {
    const f = filled();
    const it0 = f.days[0].items[0];
    it0.sets = "21";
    it0.reps = "0";
    it0.durationSeconds = "7201";
    it0.restSeconds = "901";
    const paths = validateForm(f, "draft").map((e) => e.path);
    expect(paths).toEqual(
      expect.arrayContaining(["days[0].items[0].sets", "days[0].items[0].reps", "days[0].items[0].durationSeconds", "days[0].items[0].restSeconds"]),
    );
  });
  it("rejects non-integers", () => {
    const f = filled();
    f.days[0].items[0].reps = "2.5";
    expect(validateForm(f, "draft").map((e) => e.path)).toContain("days[0].items[0].reps");
  });
  it("needs reps or a duration on every item", () => {
    const f = filled();
    f.days[0].items[1].reps = "";
    f.days[0].items[1].durationSeconds = "";
    expect(validateForm(f, "draft")).toContainEqual({ path: "days[0].items[1]", code: "measure" });
    f.days[0].items[1].durationSeconds = "45";
    expect(validateForm(f, "draft")).toEqual([]);
  });
  it("lets a draft be empty but not an active plan", () => {
    const f = emptyForm();
    f.title = "Empty";
    expect(validateForm(f, "draft")).toEqual([]);
    expect(validateForm(f, "active")).toContainEqual({ path: "days", code: "noExercises" });
  });
  it("limits item notes to 280 and 30 items per day", () => {
    const f = filled();
    f.days[0].items[0].notes = "n".repeat(281);
    expect(validateForm(f, "draft").map((e) => e.code)).toContain("tooLong");
    f.days[0].items = Array.from({ length: 31 }, () => emptyItem({ id: "e", name: "x" }));
    expect(validateForm(f, "draft").map((e) => e.code)).toContain("tooManyItems");
  });
});

describe("cadence and days", () => {
  it("daily keeps one day, renumbered to 1", () => {
    let f = emptyForm();
    f = addDay(f, 3);
    f = changeCadence(f, "daily");
    expect(f.days.map((d) => d.dayIndex)).toEqual([1]);
  });
  it("weekly drops days beyond 7 when switching from monthly", () => {
    let f = changeCadence(emptyForm(), "monthly");
    f = addDay(f, 20);
    f = addDay(f, 5);
    f = changeCadence(f, "weekly");
    expect(f.days.map((d) => d.dayIndex)).toEqual([1, 5]);
  });
  it("offers only free day indexes and ignores duplicates", () => {
    let f = emptyForm();
    expect(freeDayIndexes(f)).toEqual([2, 3, 4, 5, 6, 7]);
    f = addDay(f, 1);
    expect(f.days).toHaveLength(1);
    f = addDay(f);
    expect(f.days.map((d) => d.dayIndex)).toEqual([1, 2]);
    expect(setDayIndex(f, f.days[1].key, 1).days.map((d) => d.dayIndex)).toEqual([1, 2]);
  });
});

describe("moveItem", () => {
  it("swaps neighbours and stays put at the ends", () => {
    expect(moveItem([1, 2, 3], 1, -1)).toEqual([2, 1, 3]);
    expect(moveItem([1, 2, 3], 1, 1)).toEqual([1, 3, 2]);
    expect(moveItem([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
    expect(moveItem([1, 2, 3], 2, 1)).toEqual([1, 2, 3]);
  });
});

describe("buildPayload", () => {
  it("builds the contract body with trimmed text, null for blanks and positions 1..n", () => {
    const f = filled();
    f.days[0].items[0].notes = "  tempo 3-1-1 ";
    f.days[0].items[1].reps = "";
    f.days[0].items[1].durationSeconds = "60";
    const body = buildPayload(f, "draft");
    expect(body).toEqual({
      title: "Strength A",
      description: null,
      cadence: "weekly",
      sportSlug: null,
      status: "draft",
      days: [
        {
          dayIndex: 1,
          title: null,
          notes: null,
          items: [
            { exerciseId: "e1", position: 1, sets: 3, reps: 10, durationSeconds: null, restSeconds: 60, notes: "tempo 3-1-1" },
            { exerciseId: "e2", position: 2, sets: 3, reps: null, durationSeconds: 60, restSeconds: 60, notes: null },
          ],
        },
      ],
    });
    expect("expectedVersion" in body).toBe(false);
  });
  it("sends expectedVersion and the ids of existing items when editing", () => {
    const form = formFromPlan({
      title: "P",
      description: "d",
      cadence: "weekly",
      sportSlug: "gym",
      days: [
        { dayIndex: 2, title: "Legs", notes: null, items: [{ id: "i1", exerciseId: "e1", exerciseName: "Squat", sets: 4, reps: 8, durationSeconds: null, restSeconds: 90, notes: null }] },
      ],
    });
    const body = buildPayload(form, "active", 7);
    expect(body.expectedVersion).toBe(7);
    expect(body.sportSlug).toBe("gym");
    expect(body.days[0].items[0]).toMatchObject({ id: "i1", position: 1, sets: 4, reps: 8, restSeconds: 90 });
  });
  it("sorts days and renumbers positions after a reorder", () => {
    let f = changeCadence(filled(), "monthly");
    f = addDay(f, 3);
    f = updateDay(f, f.days[0].key, (d) => ({ ...d, items: moveItem(d.items, 1, -1) }));
    const body = buildPayload(f, "active");
    expect(body.days.map((d) => d.dayIndex)).toEqual([1, 3]);
    expect(body.days[0].items.map((i) => [i.exerciseId, i.position])).toEqual([
      ["e2", 1],
      ["e1", 2],
    ]);
  });
});

describe("validateAssign", () => {
  const ok = { memberIds: ["m1"], startsOn: "2026-11-24", endsOn: "", note: "" };
  it("accepts open-ended assignments", () => {
    expect(validateAssign(ok)).toEqual([]);
  });
  it("needs a member and a start date", () => {
    expect(validateAssign({ ...ok, memberIds: [], startsOn: "" }).map((e) => e.field)).toEqual(["memberIds", "startsOn"]);
  });
  it("rejects an end date before the start", () => {
    expect(validateAssign({ ...ok, endsOn: "2026-11-01" })).toEqual([{ field: "endsOn", code: "dateOrder" }]);
  });
  it("limits the note to 280 characters", () => {
    expect(validateAssign({ ...ok, note: "x".repeat(281) })).toEqual([{ field: "note", code: "tooLong" }]);
  });
});

describe("todayInTenantZone", () => {
  it("uses IST", () => {
    expect(todayInTenantZone(new Date("2026-11-21T19:00:00Z"))).toBe("2026-11-22");
  });
});
