import { describe, expect, it } from "vitest";
import {
  CARD_CODES,
  cardView,
  feeSlices,
  followUpReason,
  formatNumber,
  formatPercent,
  formatSigned,
  hasSignal,
  parseRangeDays,
  rangeFor,
  ratioText,
  shiftDate,
  tileFrom,
  weekdayName,
} from "../components/owner/dashboard/view-model";
import { LOCALES, messages, translate, type Locale, type MessageKey } from "../lib/i18n";

const tIn = (locale: Locale) => (key: MessageKey, params?: Record<string, string | number>) => translate(locale, key, params);

describe("range parsing", () => {
  it("accepts 7, 30 and 90 and falls back to 30", () => {
    expect(parseRangeDays("7")).toBe(7);
    expect(parseRangeDays("90")).toBe(90);
    expect(parseRangeDays(["7", "90"])).toBe(7);
    for (const bad of [undefined, "", "0", "14", "abc", "-7", "30; drop"]) expect(parseRangeDays(bad)).toBe(30);
  });
  it("builds an inclusive range ending today", () => {
    expect(rangeFor("2026-11-22", 7)).toEqual({ from: "2026-11-16", to: "2026-11-22" });
    expect(rangeFor("2026-03-01", 30).from).toBe("2026-01-31");
    expect(shiftDate("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("number formatting and nulls", () => {
  it("never turns null into 0", () => {
    expect(formatNumber(null, "en")).toBeNull();
    expect(formatNumber(undefined, "en")).toBeNull();
    expect(formatPercent(null, "en")).toBeNull();
    expect(formatSigned(null, "en")).toBeNull();
  });
  it("keeps a real zero", () => {
    expect(formatNumber(0, "en")).toBe("0");
    expect(formatPercent(0, "en")).toBe("0%");
  });
  it("formats with at most one decimal and a sign", () => {
    expect(formatPercent(72.54, "en")).toBe("72.5%");
    expect(formatSigned(4.2, "en")).toBe("+4.2");
    expect(formatSigned(-3, "en")).toBe("-3");
    expect(formatSigned(0, "en")).toBe("0");
    expect(formatNumber(1234, "en")).toBe("1,234");
  });
  it("hasSignal ignores nulls and zeros", () => {
    expect(hasSignal([null, 0, null])).toBe(false);
    expect(hasSignal([null], [0, 3])).toBe(true);
  });
  it("names weekdays Monday first", () => {
    expect(weekdayName(1, "en", "long")).toBe("Monday");
    expect(weekdayName(7, "en", "long")).toBe("Sunday");
  });
});

describe("KPI tiles", () => {
  it("passes the API change through and formats value and previous", () => {
    const m = tileFrom("attendance", { value: 81.25, previous: 75, changePercent: 8.3 }, "percent", "en");
    expect(m).toMatchObject({ value: "81.3%", previous: "75%", change: 8.3, changeText: "+8.3" });
  });
  it("a null value stays null (empty state), a null change hides the change", () => {
    const m = tileFrom("retention", { value: null, previous: null, changePercent: null }, "percent", "en");
    expect(m).toMatchObject({ value: null, previous: null, change: null, changeText: null });
  });
  it("a decrease keeps its sign and is not an error", () => {
    expect(tileFrom("a", { value: 10, previous: 20, changePercent: -50 }, "count", "en").changeText).toBe("-50");
  });
  it("sessions ratio needs both sides", () => {
    expect(ratioText(18, 20, tIn("en"), "en")).toBe("18 of 20");
    expect(ratioText(null, 20, tIn("en"), "en")).toBeNull();
  });
});

describe("insight card mapping", () => {
  const t = tIn("en");
  it("maps weekday numbers to names and keeps percents", () => {
    const v = cardView({ code: "best_weekday", tone: "positive", title: "insights.card.best_weekday", params: { weekday: "6", percent: "88.5" } }, t, "en");
    expect(v).toEqual({ code: "best_weekday", tone: "positive", text: "Saturday is your strongest day, with 88.5% attendance." });
  });
  it("translates the trend direction word", () => {
    const v = cardView({ code: "attendance_trend", tone: "attention", title: "x", params: { direction: "down", points: "6", percent: "72" } }, t, "en");
    expect(v?.text).toBe("Attendance moved down by 6 points to 72% compared with the previous period.");
    expect(v?.tone).toBe("attention");
    expect(cardView({ code: "attendance_trend", tone: "positive", title: "x", params: { direction: "up", points: "5", percent: "80" } }, t, "en")?.text).toContain("moved up");
  });
  it("maps every card code with its params in every language, without leftover placeholders", () => {
    const params: Record<string, Record<string, string>> = {
      best_weekday: { weekday: "2", percent: "90" },
      low_weekday: { weekday: "4", percent: "50" },
      attendance_trend: { direction: "up", points: "7", percent: "83" },
      new_members: { count: "4" },
      coach_consistency: { count: "2" },
      plan_adherence: { percent: "64", members: "12" },
      follow_ups: { count: "3" },
    };
    for (const locale of LOCALES) {
      for (const code of CARD_CODES) {
        const v = cardView({ code, tone: "neutral", title: `insights.card.${code}`, params: params[code] }, tIn(locale), locale);
        expect(v, `${locale}:${code}`).not.toBeNull();
        expect(v!.text, `${locale}:${code}`).not.toMatch(/\{\w+\}/);
        expect(v!.text.length).toBeGreaterThan(10);
      }
    }
  });
  it("drops unknown codes instead of showing a raw key", () => {
    expect(cardView({ code: "future_card", tone: "positive", title: "insights.card.future_card", params: {} }, t, "en")).toBeNull();
  });
  it("every card key exists in every language", () => {
    for (const locale of LOCALES) for (const code of CARD_CODES) expect(messages[locale][`insights.card.${code}` as MessageKey]).toBeTruthy();
  });
});

describe("follow-ups, fees and wording", () => {
  it("describes each reason with a friendly count", () => {
    const t = tIn("en");
    expect(followUpReason("consecutive_absences", 3, t, "en")).toBe("Missed the last 3 marked classes");
    expect(followUpReason("inactive_14_days", 21, t, "en")).toBe("No activity for 21 days");
    expect(followUpReason("workouts_pending", 20, t, "en")).toBe("Completed 20% of assigned workouts recently");
  });
  it("fee slices carry counts only, in neutral series colours", () => {
    const slices = feeSlices({ paid: 10, due: 3, overdue: 2, waived: 1 }, tIn("en"));
    expect(slices.map((s) => s.value)).toEqual([10, 3, 2, 1]);
    expect(slices.map((s) => s.label)).toEqual(["Paid", "Due", "Overdue", "Waived"]);
    expect(JSON.stringify(slices)).not.toMatch(/danger|red/);
  });
  it("dashboard strings avoid revenue and surveillance wording", () => {
    const keys = Object.keys(messages.en).filter((k) => /^(an\.|insights\.|od\.)/.test(k)) as MessageKey[];
    expect(keys.length).toBeGreaterThan(80);
    for (const k of keys) {
      const v = messages.en[k];
      expect(v, k).not.toMatch(/accountab|surveil|monitor|track(ing)? (you|member)|revenue|income|earn/i);
    }
  });
});
