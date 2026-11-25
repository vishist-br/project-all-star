import type { MessageKey } from "../i18n";

/** View-model for the owner "Class insights" screen. Pure functions over the `getClassInsights` response. */

export const INSIGHT_RANGES = ["7d", "28d", "90d"] as const;
export type InsightRange = (typeof INSIGHT_RANGES)[number];
export const DEFAULT_INSIGHT_RANGE: InsightRange = "28d";

export function parseInsightRange(raw: unknown): InsightRange {
  return typeof raw === "string" && (INSIGHT_RANGES as readonly string[]).includes(raw) ? (raw as InsightRange) : DEFAULT_INSIGHT_RANGE;
}

export type Slot = {
  batchId: string;
  batchName: string;
  sportName: string;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  capacity: number | null;
  sessionCount: number;
  avgFillRate: number | null;
  attendanceRate: number | null;
  workoutSentShare: number | null;
  waitlistCount: number;
  quietSlot: boolean;
};
export type Suggestion = { kind: string; messageKey: string; batchId: string; params: Record<string, string | number> };
export type Insights = {
  range: string;
  from: string;
  to: string;
  overall: { classesHeld: number; avgFillRate: number | null; attendanceRate: number | null; workoutSentShare: number | null };
  slots: Slot[];
  suggestions: Suggestion[];
};

const KNOWN_SUGGESTIONS = new Set<string>(["ci.addClass", "ci.moveSlot"]);

/** Translate a suggestion from its message key and params. Unknown keys are dropped (never shown as raw text). */
export function suggestionText(s: Suggestion, t: (k: MessageKey, p?: Record<string, string | number>) => string): string | null {
  return KNOWN_SUGGESTIONS.has(s.messageKey) ? t(s.messageKey as MessageKey, s.params) : null;
}

/** People who usually come, as a whole number out of capacity. Null without capacity or data. */
export function typicalAttendance(slot: Pick<Slot, "capacity" | "avgFillRate">): { n: number; of: number } | null {
  if (slot.capacity === null || slot.avgFillRate === null) return null;
  return { n: Math.round((slot.avgFillRate / 100) * slot.capacity), of: slot.capacity };
}

/** Bar width 0..100 for a rate that may be null. */
export const barPercent = (v: number | null) => (v === null ? 0 : Math.min(100, Math.max(0, v)));

export const pct = (v: number | null, locale: string) =>
  v === null ? null : `${new Intl.NumberFormat(locale === "hi" ? "hi-IN" : locale === "kn" ? "kn-IN" : "en-IN", { maximumFractionDigits: 0 }).format(v)}%`;

const TAG: Record<string, string> = { en: "en-IN", hi: "hi-IN", kn: "kn-IN" };

/** "Mon, Wed" from ISO weekdays (1 = Monday). */
export function weekdays(days: number[], locale: string): string {
  const f = new Intl.DateTimeFormat(TAG[locale] ?? "en-IN", { weekday: "short", timeZone: "UTC" });
  return [...days]
    .sort((a, b) => a - b)
    .map((d) => f.format(new Date(Date.UTC(2024, 0, d))))
    .join(", ");
}

/** "6:00 pm" from "18:00". */
export function clock(hhmm: string, locale: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return new Intl.DateTimeFormat(TAG[locale] ?? "en-IN", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 1, h ?? 0, m ?? 0)));
}
