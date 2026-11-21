import { describe, expect, it } from "vitest";
import { messages } from "../lib/i18n";
import { checkInPayload, emptyGoalForm, goalPayload, validateCheckIn, validateGoalForm } from "../lib/members/goal-form";
import {
  buildRosterRow,
  checkInReasons,
  mapLimit,
  memberQuery,
  needsCheckIn,
  parsePeriod,
  parseRosterFilters,
  percentText,
  periodRange,
  shortDate,
  sortRoster,
  weeklySeries,
  type StatsLike,
} from "../lib/members/view";

const stats = (over: Partial<{ attended: number; missed: number; excused: number; percent: number | null; scheduled: number; completed: number; adherence: number | null }> = {}): StatsLike => ({
  attendance: { attended: over.attended ?? 4, missed: over.missed ?? 0, excused: over.excused ?? 0, percent: over.percent === undefined ? 100 : over.percent },
  workouts: { scheduled: over.scheduled ?? 6, completed: over.completed ?? 6, adherencePercent: over.adherence === undefined ? 100 : over.adherence },
});

describe("check-in flag", () => {
  it("is quiet for healthy members and for members with no data", () => {
    expect(needsCheckIn(stats())).toBe(false);
    expect(needsCheckIn(null)).toBe(false);
    expect(needsCheckIn(stats({ attended: 0, missed: 0, percent: null, scheduled: 0, completed: 0, adherence: null }))).toBe(false);
  });
  it("flags low attendance only with enough marked sessions", () => {
    expect(checkInReasons(stats({ attended: 1, missed: 3, percent: 25 }))).toEqual(["attendance"]);
    expect(checkInReasons(stats({ attended: 0, missed: 2, percent: 0 }))).toEqual([]);
  });
  it("flags low workout adherence only with enough scheduled items", () => {
    expect(checkInReasons(stats({ scheduled: 10, completed: 1, adherence: 10 }))).toEqual(["adherence"]);
    expect(checkInReasons(stats({ scheduled: 3, completed: 0, adherence: 0 }))).toEqual([]);
  });
  it("can flag both and never treats excused absences as missed", () => {
    expect(checkInReasons(stats({ attended: 1, missed: 3, percent: 25, scheduled: 10, completed: 1, adherence: 10 }))).toEqual(["attendance", "adherence"]);
    // 3 excused, 4 attended: percent comes from the API (excused excluded) and stays healthy.
    expect(needsCheckIn(stats({ attended: 4, missed: 0, excused: 3, percent: 100 }))).toBe(false);
  });
});

describe("percentText", () => {
  it("shows the not-enough-data text for null, never 0%", () => {
    expect(percentText(null, "Not enough data yet")).toBe("Not enough data yet");
    expect(percentText(0, "x")).toBe("0%");
    expect(percentText(87.5, "x")).toBe("87.5%");
    expect(percentText(80, "x")).toBe("80%");
  });
});

describe("roster rows", () => {
  const names = new Map([["b1", "Morning"], ["b2", "Evening"]]);
  const member = (id: string, name: string, status: "active" | "ended" = "active") => ({ id, name, status, batchIds: ["b1", "b9"], level: "Yellow", feeStatus: "paid" as const });
  it("maps batch names, keeps null percentages and flags only active members", () => {
    const row = buildRosterRow(member("m1", "Asha"), null, names, null);
    expect(row.batchNames).toEqual(["Morning"]);
    expect(row.attendancePercent).toBeNull();
    expect(row.adherencePercent).toBeNull();
    expect(row.activePlan).toBeNull();
    const ended = buildRosterRow(member("m2", "Ben", "ended"), stats({ attended: 0, missed: 5, percent: 0 }), names, "Plan");
    expect(ended.reasons).toEqual([]);
    const flagged = buildRosterRow(member("m3", "Cy"), stats({ attended: 0, missed: 5, percent: 0 }), names, "Plan");
    expect(flagged.reasons).toEqual(["attendance"]);
  });
  it("sorts members who may like a check-in first, then by name", () => {
    const a = buildRosterRow(member("a", "Zed"), stats({ attended: 0, missed: 5, percent: 0 }), names, null);
    const b = buildRosterRow(member("b", "Amy"), stats(), names, null);
    const c = buildRosterRow(member("c", "Bob"), stats(), names, null);
    expect(sortRoster([c, b, a]).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});

describe("filters and ranges", () => {
  it("parses roster filters with safe defaults", () => {
    expect(parseRosterFilters({})).toEqual({ q: "", batchId: "", status: "active", checkIn: false });
    expect(parseRosterFilters({ q: " asha ", batchId: "b1", status: "all", checkin: "1" })).toEqual({ q: "asha", batchId: "b1", status: "all", checkIn: true });
    expect(parseRosterFilters({ status: "weird" }).status).toBe("active");
  });
  it("builds the listMembers query", () => {
    expect(memberQuery(parseRosterFilters({ q: "a", batchId: "b", status: "ended" })).toString()).toBe("limit=100&q=a&batchId=b&status=ended");
    expect(memberQuery(parseRosterFilters({ status: "all" })).has("status")).toBe(false);
  });
  it("period and range", () => {
    expect(parsePeriod("90")).toBe(90);
    expect(parsePeriod(undefined)).toBe(30);
    expect(parsePeriod("7")).toBe(30);
    expect(periodRange("2026-11-22", 30)).toEqual({ from: "2026-10-24", to: "2026-11-22" });
  });
  it("formats short dates in UTC", () => {
    expect(shortDate("2026-11-03T20:00:00.000Z", "en")).toMatch(/3/);
  });
});

describe("weeklySeries", () => {
  it("uses a gap (null) for a week with no scheduled workouts", () => {
    const s = weeklySeries(
      [
        { weekStart: "2026-11-02", attended: 2, missed: 1, workoutsCompleted: 3, workoutsScheduled: 4 },
        { weekStart: "2026-11-09", attended: 0, missed: 0, workoutsCompleted: 0, workoutsScheduled: 0 },
      ],
      (d) => d,
    );
    expect(s.adherence).toEqual([75, null]);
    expect(s.hasAttendance).toBe(true);
    expect(s.hasWorkouts).toBe(true);
    expect(weeklySeries([], (d) => d).hasAttendance).toBe(false);
  });
});

describe("mapLimit", () => {
  it("keeps order and never exceeds the limit", async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 2));
      running -= 1;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12]);
    expect(peak).toBeLessThanOrEqual(2);
  });
});

describe("goal form", () => {
  const today = "2026-11-22";
  it("requires a title and a positive target for session and workout goals", () => {
    const errs = validateGoalForm(emptyGoalForm(), today);
    expect(errs.map((e) => e.field).sort()).toEqual(["targetValue", "title"]);
    expect(validateGoalForm({ ...emptyGoalForm(), title: "Attend 12", targetValue: "0" }, today)).toEqual([{ field: "targetValue", code: "positive" }]);
    expect(validateGoalForm({ ...emptyGoalForm(), title: "Attend 12", targetValue: "12" }, today)).toEqual([]);
  });
  it("level goals need a level, custom goals allow a zero target and a start value", () => {
    expect(validateGoalForm({ ...emptyGoalForm(), title: "Belt", metric: "level" }, today)).toEqual([{ field: "targetLevelId", code: "required" }]);
    expect(validateGoalForm({ ...emptyGoalForm(), title: "Weight", metric: "custom", targetValue: "0", startValue: "x" }, today)).toEqual([{ field: "startValue", code: "number" }]);
  });
  it("rejects past dates and long text", () => {
    expect(validateGoalForm({ ...emptyGoalForm(), title: "a", targetValue: "5", targetDate: "2026-11-01" }, today)).toEqual([{ field: "targetDate", code: "date" }]);
    expect(validateGoalForm({ ...emptyGoalForm(), title: "x".repeat(121), targetValue: "5" }, today)).toEqual([{ field: "title", code: "title" }]);
  });
  it("builds payloads for each metric", () => {
    expect(goalPayload({ ...emptyGoalForm(), title: " Attend 12 ", targetValue: "12" })).toEqual({ title: "Attend 12", metric: "sessions_attended", targetValue: 12 });
    expect(goalPayload({ ...emptyGoalForm(), title: "Belt", metric: "level", targetLevelId: "lv1", targetValue: "9" })).toEqual({ title: "Belt", metric: "level", targetLevelId: "lv1" });
    expect(goalPayload({ ...emptyGoalForm(), title: "Weight", metric: "custom", targetValue: "70", startValue: "80", unit: "kg", targetDate: "2027-01-01" })).toEqual({
      title: "Weight",
      metric: "custom",
      targetValue: 70,
      startValue: 80,
      unit: "kg",
      targetDate: "2027-01-01",
    });
  });
  it("validates check-ins", () => {
    expect(validateCheckIn({ value: "", note: "" })).toEqual([{ field: "value", code: "required" }]);
    expect(validateCheckIn({ value: "abc", note: "" })).toEqual([{ field: "value", code: "number" }]);
    expect(validateCheckIn({ value: "72.5", note: "x".repeat(281) })).toEqual([{ field: "note", code: "note" }]);
    expect(checkInPayload({ value: "72.5", note: " ok " })).toEqual({ value: 72.5, note: "ok" });
  });
});

describe("wording", () => {
  it("new member screen strings use visibility wording, never accountability or surveillance", () => {
    const keys = Object.keys(messages.en).filter((k) => /^(roster|member|goals|record|plans\.member)\./.test(k));
    expect(keys.length).toBeGreaterThan(100);
    for (const locale of ["en", "hi", "kn"] as const) {
      for (const k of keys) {
        expect((messages[locale] as Record<string, string>)[k], `${locale}:${k}`).not.toMatch(/accountab|surveil|monitor|spy|track(ing)? your/i);
      }
    }
  });
});
