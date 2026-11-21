/**
 * Schedule expansion (docs/PLAN-POC.md 2.5). Pure: no database, no clock. Dates are
 * `YYYY-MM-DD` strings in the tenant timezone.
 */
export type Cadence = "daily" | "weekly" | "monthly";
export type AssignmentState = "active" | "paused" | "ended";

export type ExpandItem = { id: string; archivedAt?: Date | string | null };
export type ExpandDay<I extends ExpandItem = ExpandItem> = { dayIndex: number; items: I[] };
export type ExpandAssignment = { status: AssignmentState; startsOn: string; endsOn?: string | null };
export type ExpandPlan<I extends ExpandItem = ExpandItem> = { cadence: Cadence; days: ExpandDay<I>[] };

export type ScheduledDay<I extends ExpandItem = ExpandItem> = { date: string; dayIndex: number; items: I[] };

const DAY_MS = 86_400_000;
const parse = (d: string) => new Date(`${d}T00:00:00Z`);
const fmt = (t: number) => new Date(t).toISOString().slice(0, 10);

export function isoWeekday(date: string): number {
  const w = parse(date).getUTCDay();
  return w === 0 ? 7 : w;
}

/** The plan day index a date falls on for the cadence (monthly: day of month, may not exist in short months). */
export function dayIndexFor(cadence: Cadence, date: string): number {
  if (cadence === "daily") return 1;
  if (cadence === "weekly") return isoWeekday(date);
  return Number(date.slice(8, 10));
}

/** Key used for the `logged` set: item id and date. */
export const logKey = (itemId: string, date: string) => `${itemId}|${date}`;

/**
 * Dated workout items of one assignment in [from, to] (inclusive). Only ACTIVE assignments
 * schedule anything: paused and ended ones return nothing (documented simplification, no
 * pause history is kept). Callers that need the past of an ended assignment can pass it with
 * status "active" and its `endsOn`.
 * An item with `archivedAt` (edited away) appears only on dates that have a log for it
 * (`logged`) and that are on or before the day it was archived.
 */
export function expandSchedule<I extends ExpandItem>(
  assignment: ExpandAssignment,
  plan: ExpandPlan<I>,
  from: string,
  to: string,
  logged: ReadonlySet<string> = new Set(),
): ScheduledDay<I>[] {
  if (assignment.status !== "active") return [];
  const out: ScheduledDay<I>[] = [];
  const start = Math.max(parse(from).getTime(), parse(assignment.startsOn).getTime());
  const endBound = assignment.endsOn ? Math.min(parse(to).getTime(), parse(assignment.endsOn).getTime()) : parse(to).getTime();
  const byIndex = new Map(plan.days.map((d) => [d.dayIndex, d]));
  for (let t = start; t <= endBound; t += DAY_MS) {
    const date = fmt(t);
    const day = byIndex.get(dayIndexFor(plan.cadence, date));
    if (!day) continue;
    const items = day.items.filter((it) => {
      if (!it.archivedAt) return true;
      const archived = fmt(new Date(it.archivedAt).getTime() + 330 * 60_000);
      return logged.has(logKey(it.id, date)) && archived >= date;
    });
    if (items.length > 0) out.push({ date, dayIndex: day.dayIndex, items });
  }
  return out;
}
