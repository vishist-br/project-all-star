// Pure view-model helpers for the owner dashboard: formatting, null handling and insight-card
// parameter mapping. No React, no data access, so they are unit-tested directly. Every number
// shown comes from the analytics API; nothing here recomputes a metric.
import type { MessageKey, Params } from "@/lib/i18n";

export const RANGES = [7, 30, 90] as const;
export type RangeDays = (typeof RANGES)[number];
export const DEFAULT_RANGE: RangeDays = 30;

type Translate = (key: MessageKey, params?: Params) => string;

/** `?range=7|30|90`, anything else falls back to 30 days. */
export function parseRangeDays(value: string | string[] | undefined): RangeDays {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = Number(raw);
  return (RANGES as readonly number[]).includes(n) ? (n as RangeDays) : DEFAULT_RANGE;
}

/** Date arithmetic on YYYY-MM-DD strings (UTC, no time zone surprises). */
export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The inclusive range ending on `today` and covering `days` days. */
export function rangeFor(today: string, days: RangeDays): { from: string; to: string } {
  return { from: shiftDate(today, -(days - 1)), to: today };
}

const intlLocale = (locale: string) => (locale === "en" ? "en-IN" : locale);

/** 12 -> "12", 12.5 -> "12.5" in the user's number format. At most one decimal. */
export function formatNumber(value: number | null | undefined, locale: string): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 1 }).format(value);
}

/** "72.5%" or null. A null percentage is never shown as 0: callers render the empty state. */
export function formatPercent(value: number | null | undefined, locale: string): string | null {
  const n = formatNumber(value, locale);
  return n === null ? null : `${n}%`;
}

/** Signed relative change, "+4.2" / "-3" / "0". Null when the API has no comparison. */
export function formatSigned(value: number | null | undefined, locale: string): string | null {
  if (value === null || value === undefined) return null;
  const n = formatNumber(Math.abs(value), locale);
  if (n === null) return null;
  if (value === 0) return n;
  return `${value > 0 ? "+" : "-"}${n}`;
}

export type KpiLike = { value: number | null; previous: number | null; changePercent: number | null };

export type TileModel = {
  key: string;
  /** Display value; null means "not enough data yet". */
  value: string | null;
  previous: string | null;
  change: number | null;
  changeText: string | null;
};

/**
 * One KPI tile from an API Kpi. `unit` decides how value and previous read.
 * The change is the API's changePercent (relative to the previous period), only formatted here.
 */
export function tileFrom(key: string, k: KpiLike, unit: "count" | "percent", locale: string): TileModel {
  const fmt = (v: number | null) => (unit === "percent" ? formatPercent(v, locale) : formatNumber(v, locale));
  return {
    key,
    value: fmt(k.value),
    previous: k.previous === null ? null : fmt(k.previous),
    change: k.changePercent,
    changeText: formatSigned(k.changePercent, locale),
  };
}

/** "18 of 20" style pair; null when either side is missing. */
export function ratioText(a: number | null, b: number | null, t: Translate, locale: string): string | null {
  const x = formatNumber(a, locale);
  const y = formatNumber(b, locale);
  return x === null || y === null ? null : t("an.kpi.sessionsValue", { completed: x, scheduled: y });
}

/** Short day-month label for a week start, for example "16 Nov". */
export function shortDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
}

/** ISO weekday 1 (Monday) to 7 (Sunday) as a name; 2024-01-01 was a Monday. */
export function weekdayName(isoDay: number, locale: string, style: "short" | "long" = "short"): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { weekday: style, timeZone: "UTC" }).format(Date.UTC(2024, 0, isoDay));
}

/** "Nov 2026" for a YYYY-MM cohort month. */
export function monthLabel(month: string, locale: string): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
}

/** True when a series has at least one real (non-null) value above zero. */
export function hasSignal(...series: (number | null)[][]): boolean {
  return series.some((s) => s.some((v) => v !== null && v > 0));
}

// ---- insight cards ----

export type InsightCardLike = { code: string; tone: string; title: string; params: Record<string, string> };

export const CARD_CODES = ["best_weekday", "low_weekday", "attendance_trend", "new_members", "coach_consistency", "plan_adherence", "follow_ups"] as const;

export type CardView = { code: string; tone: "positive" | "attention" | "neutral"; text: string };

/**
 * Turns an API card (i18n key in `title`, string params) into display text. Weekday numbers become
 * weekday names, "up"/"down" become words and counts are number-formatted. Unknown codes are
 * dropped so a newer backend never shows a raw key.
 */
export function cardView(card: InsightCardLike, t: Translate, locale: string): CardView | null {
  if (!(CARD_CODES as readonly string[]).includes(card.code)) return null;
  const p: Params = {};
  for (const [name, raw] of Object.entries(card.params)) {
    if (name === "weekday") p[name] = weekdayName(Number(raw), locale, "long");
    else if (name === "direction") p[name] = t(raw === "up" ? "insights.dir.up" : "insights.dir.down");
    else {
      const n = Number(raw);
      p[name] = raw !== "" && Number.isFinite(n) ? (formatNumber(n, locale) ?? raw) : raw;
    }
  }
  const tone = card.tone === "positive" || card.tone === "attention" ? card.tone : "neutral";
  return { code: card.code, tone, text: t(`insights.card.${card.code}` as MessageKey, p) };
}

// ---- follow-ups ----

/** Reason text. `detail` is a count of absences, a number of days, or the completed workout percent. */
export function followUpReason(reason: string, detail: number, t: Translate, locale: string): string {
  const n = formatNumber(detail, locale) ?? String(detail);
  switch (reason) {
    case "consecutive_absences":
      return t("an.followups.reason.consecutive_absences", { n });
    case "inactive_14_days":
      return t("an.followups.reason.inactive_14_days", { n });
    default:
      return t("an.followups.reason.workouts_pending", { n });
  }
}

// ---- fees ----

export type FeeCounts = { paid: number; due: number; overdue: number; waived: number };

export function feeSlices(c: FeeCounts, t: Translate) {
  return [
    { label: t("fee.paid"), value: c.paid },
    { label: t("fee.due"), value: c.due, color: "var(--c4)" },
    { label: t("fee.overdue"), value: c.overdue, color: "var(--c2)" },
    { label: t("an.fee.waived"), value: c.waived, color: "var(--c3)" },
  ];
}
