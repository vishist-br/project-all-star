/** Pure view-model helpers for the owner Coaches pages (no React, no database). */

export type LoadBand = "unknown" | "light" | "balanced" | "full";

/** Workload band from the booked share of available hours. Null means there is no availability to compare with. */
export function loadBand(loadPercent: number | null | undefined): LoadBand {
  if (loadPercent === null || loadPercent === undefined || !Number.isFinite(loadPercent)) return "unknown";
  if (loadPercent < 40) return "light";
  if (loadPercent <= 85) return "balanced";
  return "full";
}

/** Width for a workload bar: 0..100, empty when there is no figure. */
export function barWidth(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

export const COACH_SORTS = ["name", "members", "load", "upcoming"] as const;
export type CoachSort = (typeof COACH_SORTS)[number];

export function parseCoachSort(value: string | string[] | undefined): CoachSort {
  return typeof value === "string" && (COACH_SORTS as readonly string[]).includes(value) ? (value as CoachSort) : "name";
}

export type CoachRow = { id: string; name: string; memberCount: number; upcomingSessions7d: number; loadPercent: number | null };

/** Stable sort. Coaches without a load figure go last when sorting by load. Name is always the tie-break. */
export function sortCoachRows<T extends CoachRow>(rows: T[], sort: CoachSort): T[] {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  const copy = [...rows];
  switch (sort) {
    case "members":
      return copy.sort((a, b) => b.memberCount - a.memberCount || byName(a, b));
    case "upcoming":
      return copy.sort((a, b) => b.upcomingSessions7d - a.upcomingSessions7d || byName(a, b));
    case "load":
      return copy.sort((a, b) => (b.loadPercent ?? -1) - (a.loadPercent ?? -1) || byName(a, b));
    default:
      return copy.sort(byName);
  }
}

export type Slot = { id: string; weekday: number; startTime: string; endTime: string; venueId: string | null };
export type DaySlots = { weekday: number; slots: { id: string; start: string; end: string; venue: string | null }[] };

/** Weekly availability grouped Monday to Sunday; days without slots are omitted. */
export function groupAvailability(slots: Slot[], venueNames: Map<string, string>): DaySlots[] {
  const days = new Map<number, DaySlots>();
  for (const s of [...slots].sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime))) {
    const day = days.get(s.weekday) ?? { weekday: s.weekday, slots: [] };
    day.slots.push({ id: s.id, start: s.startTime, end: s.endTime, venue: s.venueId ? (venueNames.get(s.venueId) ?? null) : null });
    days.set(s.weekday, day);
  }
  return [...days.values()];
}

/** Hours with at most one decimal: 7.5 -> "7.5", 8 -> "8". */
export function formatHours(hours: number): string {
  return String(Math.round(hours * 10) / 10);
}
