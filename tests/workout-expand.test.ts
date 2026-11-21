import { describe, expect, it } from "vitest";
import { dayIndexFor, expandSchedule, isoWeekday, logKey, type ExpandItem, type ExpandPlan } from "../lib/workouts/expand";

const item = (id: string, archivedAt: string | null = null): ExpandItem => ({ id, archivedAt });
const dates = (r: { date: string }[]) => r.map((d) => d.date);
const active = (startsOn: string, endsOn: string | null = null) => ({ status: "active" as const, startsOn, endsOn });

describe("expandSchedule", () => {
  it("computes ISO weekdays and day indexes", () => {
    expect(isoWeekday("2026-11-22")).toBe(7); // Sunday
    expect(isoWeekday("2026-11-23")).toBe(1); // Monday
    expect(dayIndexFor("daily", "2026-11-23")).toBe(1);
    expect(dayIndexFor("weekly", "2026-11-25")).toBe(3);
    expect(dayIndexFor("monthly", "2026-11-25")).toBe(25);
  });

  it("daily: every date in range, bounded by startsOn", () => {
    const plan: ExpandPlan = { cadence: "daily", days: [{ dayIndex: 1, items: [item("a"), item("b")] }] };
    const r = expandSchedule(active("2026-11-24"), plan, "2026-11-22", "2026-11-26");
    expect(dates(r)).toEqual(["2026-11-24", "2026-11-25", "2026-11-26"]);
    expect(r[0].items.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("weekly: only the ISO weekdays that have a day", () => {
    const plan: ExpandPlan = {
      cadence: "weekly",
      days: [
        { dayIndex: 1, items: [item("mon")] },
        { dayIndex: 4, items: [item("thu")] },
      ],
    };
    const r = expandSchedule(active("2026-11-01"), plan, "2026-11-23", "2026-11-29");
    expect(dates(r)).toEqual(["2026-11-23", "2026-11-26"]);
    expect(r.map((d) => d.dayIndex)).toEqual([1, 4]);
  });

  it("monthly: day of month, 29-31 skipped in shorter months", () => {
    const plan: ExpandPlan = { cadence: "monthly", days: [{ dayIndex: 31, items: [item("x")] }, { dayIndex: 1, items: [item("y")] }] };
    const r = expandSchedule(active("2026-01-01"), plan, "2026-02-01", "2026-04-30");
    // Feb has no 31st, Mar has, Apr has not.
    expect(dates(r)).toEqual(["2026-02-01", "2026-03-01", "2026-03-31", "2026-04-01"]);
    const feb = expandSchedule(active("2026-01-01"), { cadence: "monthly", days: [{ dayIndex: 29, items: [item("z")] }] }, "2026-02-01", "2026-02-28");
    expect(feb).toEqual([]);
    const leap = expandSchedule(active("2024-01-01"), { cadence: "monthly", days: [{ dayIndex: 29, items: [item("z")] }] }, "2024-02-01", "2024-02-29");
    expect(dates(leap)).toEqual(["2024-02-29"]);
  });

  it("respects startsOn and endsOn bounds (inclusive)", () => {
    const plan: ExpandPlan = { cadence: "daily", days: [{ dayIndex: 1, items: [item("a")] }] };
    const r = expandSchedule(active("2026-11-23", "2026-11-25"), plan, "2026-11-01", "2026-11-30");
    expect(dates(r)).toEqual(["2026-11-23", "2026-11-24", "2026-11-25"]);
    expect(expandSchedule(active("2026-12-01"), plan, "2026-11-01", "2026-11-30")).toEqual([]);
  });

  it("paused and ended assignments schedule nothing", () => {
    const plan: ExpandPlan = { cadence: "daily", days: [{ dayIndex: 1, items: [item("a")] }] };
    expect(expandSchedule({ status: "paused", startsOn: "2026-11-01" }, plan, "2026-11-01", "2026-11-30")).toEqual([]);
    expect(expandSchedule({ status: "ended", startsOn: "2026-11-01", endsOn: "2026-11-10" }, plan, "2026-11-01", "2026-11-30")).toEqual([]);
  });

  it("archived items appear only on logged dates on or before they were archived; empty days vanish", () => {
    const plan: ExpandPlan = {
      cadence: "daily",
      days: [{ dayIndex: 1, items: [item("live"), item("old", "2026-11-25T06:00:00.000Z")] }],
    };
    const logged = new Set([logKey("old", "2026-11-24")]);
    const r = expandSchedule(active("2026-11-23"), plan, "2026-11-23", "2026-11-26", logged);
    expect(r.find((d) => d.date === "2026-11-24")!.items.map((i) => i.id)).toEqual(["live", "old"]);
    expect(r.find((d) => d.date === "2026-11-23")!.items.map((i) => i.id)).toEqual(["live"]);
    const onlyOld: ExpandPlan = { cadence: "daily", days: [{ dayIndex: 1, items: [item("old", "2026-11-25T06:00:00.000Z")] }] };
    expect(expandSchedule(active("2026-11-23"), onlyOld, "2026-11-23", "2026-11-26")).toEqual([]);
  });
});
