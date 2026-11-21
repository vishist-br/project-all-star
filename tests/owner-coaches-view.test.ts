import { describe, expect, it } from "vitest";
import { barWidth, formatHours, groupAvailability, loadBand, parseCoachSort, sortCoachRows } from "@/components/owner/coaches/view-model";
import { fill, filterOptions, pickFilter, summariseSchedule } from "@/components/owner/batches/view-model";
import { MAX_CANCEL_MINUTES, parseCancelWindow, splitMinutes, validateRules } from "@/components/owner/settings/view-model";
import { messages } from "@/lib/i18n";

describe("coach workload", () => {
  it("bands the load and treats null as unknown", () => {
    expect(loadBand(null)).toBe("unknown");
    expect(loadBand(undefined)).toBe("unknown");
    expect(loadBand(0)).toBe("light");
    expect(loadBand(39.9)).toBe("light");
    expect(loadBand(40)).toBe("balanced");
    expect(loadBand(85)).toBe("balanced");
    expect(loadBand(86)).toBe("full");
    expect(loadBand(140)).toBe("full");
  });

  it("clamps the bar width and never draws null as a value", () => {
    expect(barWidth(null)).toBe(0);
    expect(barWidth(-5)).toBe(0);
    expect(barWidth(250)).toBe(100);
    expect(barWidth(62.5)).toBe(62.5);
  });

  it("sorts coaches with a stable name tie-break and unknown load last", () => {
    const rows = [
      { id: "a", name: "Zed", memberCount: 5, upcomingSessions7d: 2, loadPercent: null },
      { id: "b", name: "Amit", memberCount: 5, upcomingSessions7d: 4, loadPercent: 70 },
      { id: "c", name: "Bina", memberCount: 9, upcomingSessions7d: 4, loadPercent: 20 },
    ];
    expect(sortCoachRows(rows, "name").map((r) => r.id)).toEqual(["b", "c", "a"]);
    expect(sortCoachRows(rows, "members").map((r) => r.id)).toEqual(["c", "b", "a"]);
    expect(sortCoachRows(rows, "upcoming").map((r) => r.id)).toEqual(["b", "c", "a"]);
    expect(sortCoachRows(rows, "load").map((r) => r.id)).toEqual(["b", "c", "a"]);
    expect(rows[0].id).toBe("a"); // input is not mutated
    expect(parseCoachSort("load")).toBe("load");
    expect(parseCoachSort("evil")).toBe("name");
    expect(parseCoachSort(undefined)).toBe("name");
  });

  it("groups availability by weekday in time order and resolves venue names", () => {
    const venues = new Map([["v1", "Main hall"]]);
    const days = groupAvailability(
      [
        { id: "3", weekday: 3, startTime: "17:00", endTime: "19:00", venueId: null },
        { id: "2", weekday: 1, startTime: "17:00", endTime: "18:00", venueId: "v1" },
        { id: "1", weekday: 1, startTime: "06:00", endTime: "08:00", venueId: "gone" },
      ],
      venues,
    );
    expect(days.map((d) => d.weekday)).toEqual([1, 3]);
    expect(days[0].slots.map((s) => s.start)).toEqual(["06:00", "17:00"]);
    expect(days[0].slots.map((s) => s.venue)).toEqual([null, "Main hall"]);
    expect(groupAvailability([], venues)).toEqual([]);
  });

  it("formats hours with at most one decimal", () => {
    expect(formatHours(8)).toBe("8");
    expect(formatHours(7.54)).toBe("7.5");
  });
});

describe("booking rules validation", () => {
  it("accepts whole minutes from 0 to 2880", () => {
    expect(parseCancelWindow("0")).toEqual({ ok: true, value: 0 });
    expect(parseCancelWindow(" 120 ")).toEqual({ ok: true, value: 120 });
    expect(parseCancelWindow(String(MAX_CANCEL_MINUTES))).toEqual({ ok: true, value: 2880 });
  });

  it("explains what is wrong", () => {
    expect(parseCancelWindow("")).toEqual({ ok: false, error: "required" });
    expect(parseCancelWindow("  ")).toEqual({ ok: false, error: "required" });
    expect(parseCancelWindow("1.5")).toEqual({ ok: false, error: "integer" });
    expect(parseCancelWindow("abc")).toEqual({ ok: false, error: "integer" });
    expect(parseCancelWindow("-1")).toEqual({ ok: false, error: "range" });
    expect(parseCancelWindow("2881")).toEqual({ ok: false, error: "range" });
  });

  it("builds the settings body and splits minutes for the hint", () => {
    expect(validateRules({ cancelWindow: "90", waitlistEnabled: true, showMissedSessionCost: false })).toEqual({
      ok: true,
      value: { bookingCancelWindowMinutes: 90, waitlistEnabled: true, showMissedSessionCost: false },
    });
    expect(validateRules({ cancelWindow: "x", waitlistEnabled: true, showMissedSessionCost: false }).ok).toBe(false);
    expect(splitMinutes(150)).toEqual({ hours: 2, minutes: 30 });
  });
});

describe("batches view", () => {
  const batches = [
    { sportId: "s2", sportName: "Yoga", venueId: "v2", venueName: "Studio" },
    { sportId: "s1", sportName: "Karate", venueId: "v1", venueName: "Dojo" },
    { sportId: "s1", sportName: "Karate", venueId: "v2", venueName: "Studio" },
  ];

  it("derives distinct sorted filter options and rejects unknown ids", () => {
    const o = filterOptions(batches);
    expect(o.venues.map((v) => v.name)).toEqual(["Dojo", "Studio"]);
    expect(o.sports.map((v) => v.name)).toEqual(["Karate", "Yoga"]);
    expect(pickFilter("v1", o.venues)).toBe("v1");
    expect(pickFilter("nope", o.venues)).toBeUndefined();
    expect(pickFilter(["v1"], o.venues)).toBeUndefined();
    expect(pickFilter(undefined, o.venues)).toBeUndefined();
  });

  it("computes the capacity fill", () => {
    expect(fill(5, null)).toEqual({ percent: null, full: false, open: null });
    expect(fill(5, 20)).toEqual({ percent: 25, full: false, open: 15 });
    expect(fill(20, 20)).toEqual({ percent: 100, full: true, open: 0 });
    expect(fill(25, 20)).toEqual({ percent: 100, full: true, open: 0 });
  });

  it("summarises the schedule", () => {
    expect(summariseSchedule([])).toBeNull();
    expect(summariseSchedule([{ weekday: 5, startTime: "18:00", endTime: "19:00" }, { weekday: 2, startTime: "18:00", endTime: "19:00" }])).toEqual({ weekdays: [2, 5], time: "18:00–19:00" });
  });
});

describe("i18n coverage", () => {
  it("has every new key in English, Hindi and Kannada, without raw placeholders left over", () => {
    const keys = Object.keys(messages.en).filter((k) => /^(oc|bk|set|ob|cs)\./.test(k));
    expect(keys.length).toBeGreaterThan(60);
    for (const lang of ["hi", "kn"] as const) {
      for (const k of keys) expect(messages[lang][k as keyof typeof messages.en], `${lang} ${k}`).toBeTruthy();
    }
    const banned = /accountab|surveil/i;
    for (const k of keys) expect(messages.en[k as keyof typeof messages.en]).not.toMatch(banned);
  });
});
