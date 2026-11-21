import { describe, expect, it } from "vitest";
import { LOCALES, messages, translate, type Locale } from "../lib/i18n";
import { describeUpdate, newestCreatedAt } from "../lib/customer/updates";
import { countByStatus, groupByPlan, targetParts, toWorkoutItems } from "../lib/customer/items";
import { formatSeconds } from "../lib/customer/format";

const tFor = (l: Locale) => (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) => translate(l, key, params);
const KINDS = [
  "plan_assigned",
  "plan_updated",
  "plan_ended",
  "goal_set",
  "goal_updated",
  "session_scheduled",
  "session_rescheduled",
  "session_cancelled",
  "booking_confirmed",
  "waitlist_promoted",
];

describe("updates feed rendering", () => {
  it("renders every kind from i18n, in every language, with no leftover placeholders", () => {
    for (const locale of LOCALES) {
      for (const kind of KINDS) {
        const v = describeUpdate(
          { kind, params: { planTitle: "Kids Daily Basics", goalTitle: "Yellow belt", batchName: "Kids Karate", startsAt: "2026-11-23T11:30:00.000Z" } },
          tFor(locale),
          locale,
        );
        expect(v.text, `${locale}:${kind}`).toBeTruthy();
        expect(v.text).not.toMatch(/\{\w+\}/);
      }
    }
  });

  it("uses the translation, not the API's English fallback title", () => {
    const hi = describeUpdate({ kind: "plan_assigned", params: { planTitle: "Daily Basics" } }, tFor("hi"), "hi");
    expect(hi.text).toBe(messages.hi["upd.plan_assigned"].replace("{plan}", "Daily Basics"));
    expect(hi.text).not.toBe("New workout plan: Daily Basics");
  });

  it("picks the variant from params (paused, achieved, cancel reason) and carries the coach note", () => {
    const t = tFor("en");
    expect(describeUpdate({ kind: "plan_updated", params: { planTitle: "P", status: "paused" } }, t, "en").text).toBe("Your plan P is paused for now");
    expect(describeUpdate({ kind: "plan_updated", params: { planTitle: "P" } }, t, "en").text).toBe("Your coach updated your plan: P");
    expect(describeUpdate({ kind: "goal_updated", params: { goalTitle: "G", status: "achieved" } }, t, "en").text).toContain("You reached your goal");
    expect(describeUpdate({ kind: "session_cancelled", params: { batchName: "B", reason: "holiday", startsAt: "2026-11-23T11:30:00.000Z" } }, t, "en").text).toContain("holiday");
    expect(describeUpdate({ kind: "session_cancelled", params: { batchName: "B", reason: "coach_unavailable", startsAt: "2026-11-23T11:30:00.000Z" } }, t, "en").text).toContain("coach is unavailable");
    expect(describeUpdate({ kind: "plan_assigned", params: { planTitle: "P", note: " Go easy at first " } }, t, "en").note).toBe("Go easy at first");
    expect(describeUpdate({ kind: "plan_ended", params: { planTitle: "P", note: "x" } }, t, "en").note).toBeNull();
  });

  it("formats session times in the business timezone and tolerates missing params", () => {
    const v = describeUpdate({ kind: "session_scheduled", params: { batchName: "Kids", startsAt: "2026-11-23T11:30:00.000Z" } }, tFor("en"), "en");
    expect(v.text).toContain("5:00");
    expect(describeUpdate({ kind: "session_scheduled", params: {} }, tFor("en"), "en").text).toBe("A session is on the calendar for soon");
    expect(describeUpdate({ kind: "something_new", params: {} }, tFor("en"), "en")).toMatchObject({ category: "other", text: messages.en["upd.generic"] });
  });

  it("marks read up to the newest createdAt", () => {
    expect(newestCreatedAt([])).toBeNull();
    expect(
      newestCreatedAt([{ createdAt: "2026-11-20T10:00:00.000Z" }, { createdAt: "2026-11-21T09:30:00.000Z" }, { createdAt: "2026-11-19T10:00:00.000Z" }]),
    ).toBe("2026-11-21T09:30:00.000Z");
  });

  it("uses positive wording with no accountability or surveillance terms", () => {
    for (const l of LOCALES) for (const [k, v] of Object.entries(messages[l])) if (/^(cu|upd|ex)\./.test(k)) expect(v.toLowerCase()).not.toMatch(/accountab|surveil|failed to|you missed|overdue/);
  });
});

describe("workout items helpers", () => {
  const day = {
    date: "2026-11-21",
    items: [
      { assignmentId: "a", planId: "p1", planTitle: "Plan 1", planItemId: "i1", exerciseId: "e1", exerciseName: "Squat", position: 0, sets: 3, reps: 10, durationSeconds: null, restSeconds: 30, notes: null, status: "completed" as const },
      { assignmentId: "a", planId: "p1", planTitle: "Plan 1", planItemId: "i2", exerciseId: "e2", exerciseName: "Plank", position: 1, sets: 2, reps: null, durationSeconds: 60, restSeconds: null, notes: "slow", status: "started" as const },
      { assignmentId: "b", planId: "p2", planTitle: "Plan 2", planItemId: "i3", exerciseId: "e3", exerciseName: "Walk", position: 0, sets: null, reps: null, durationSeconds: 90, restSeconds: null, notes: null, status: "skipped" as const },
      { assignmentId: "b", planId: "p2", planTitle: "Plan 2", planItemId: "i4", exerciseId: "e4", exerciseName: "Stretch", position: 1, sets: null, reps: 5, durationSeconds: null, restSeconds: null, notes: null, status: "pending" as const },
    ],
  };
  const items = toWorkoutItems(day);

  it("groups by plan in order and counts statuses", () => {
    expect(groupByPlan(items).map((g) => [g.planTitle, g.items.length])).toEqual([["Plan 1", 2], ["Plan 2", 2]]);
    expect(countByStatus(items)).toEqual({ done: 1, skipped: 1, todo: 2 });
    expect(items.every((i) => i.date === "2026-11-21")).toBe(true);
  });

  it("describes sets, reps, duration and rest", () => {
    const t = tFor("en");
    // Unit names come from Intl (ICU), so match the numbers and the shape rather than the exact abbreviation.
    const p0 = targetParts(items[0]!, t, "en");
    expect(p0[0]).toBe("3 sets × 10 reps");
    expect(p0[1]).toMatch(/^Rest 30 sec/);
    const p1 = targetParts(items[1]!, t, "en");
    expect(p1[0]).toBe("2 sets");
    expect(p1[1]).toMatch(/^1 min.* per set$/);
    expect(targetParts(items[2]!, t, "en")).toEqual([formatSeconds(90, "en")]);
    expect(targetParts(items[3]!, t, "en")).toEqual(["5 reps"]);
  });
});
