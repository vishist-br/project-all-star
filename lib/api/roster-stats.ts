import type { TenantClient } from "../tenant-scope";
import { extendsTimeline } from "./attendance";
import { holidayDates, pct } from "./member-stats";
import { tenantDate } from "./pagination";
import { addDays, loadScheduledEntries, startOfDay } from "./schedule";

/** The slice of getMemberStats the roster needs. Same shape as `StatsLike` in lib/members/view.ts. */
export type RosterStats = {
  attendance: { attended: number; missed: number; excused: number; percent: number | null };
  workouts: { scheduled: number; completed: number; adherencePercent: number | null };
};

/**
 * Attendance and workout adherence for many members in a fixed number of queries (three, plus the
 * plan expansion), with the same rules as getMemberStats. Callers pass ids they may already view
 * (they came out of listMembers), so there is no per-member access check. Replaces one
 * getMemberStats call per roster row (about 10 queries each).
 */
export async function getRosterStats(
  db: TenantClient,
  memberIds: string[],
  from: string,
  to: string,
  now = new Date(),
): Promise<Map<string, RosterStats>> {
  const out = new Map<string, RosterStats>();
  if (memberIds.length === 0) return out;
  const today = tenantDate(now);
  const [attendance, holidays, entries] = await Promise.all([
    db.attendance.findMany({
      where: {
        memberId: { in: memberIds },
        session: { startsAt: { gte: startOfDay(from), lt: startOfDay(addDays(to, 1)) }, status: "COMPLETED" },
      },
      select: { memberId: true, status: true, session: { select: { startsAt: true } } },
    }),
    holidayDates(db, from, to),
    loadScheduledEntries(db, memberIds, from, to),
  ]);
  const acc = new Map(memberIds.map((id) => [id, { attended: 0, missed: 0, excused: 0, scheduled: 0, completed: 0 }]));
  for (const a of attendance) {
    const holiday = holidays.has(tenantDate(a.session.startsAt));
    if (holiday) continue;
    const c = acc.get(a.memberId);
    if (!c) continue;
    if (a.status === "PRESENT") c.attended += 1;
    else if (extendsTimeline(a.status, holiday)) c.missed += 1;
    else if (a.status === "EXCUSED") c.excused += 1;
  }
  for (const e of entries) {
    if (e.date > today) continue;
    const c = acc.get(e.memberId);
    if (!c) continue;
    c.scheduled += 1;
    if (e.log?.status === "completed") c.completed += 1;
  }
  for (const [id, c] of acc) {
    out.set(id, {
      attendance: { attended: c.attended, missed: c.missed, excused: c.excused, percent: pct(c.attended, c.attended + c.missed) },
      workouts: { scheduled: c.scheduled, completed: c.completed, adherencePercent: pct(c.completed, c.scheduled) },
    });
  }
  return out;
}
