import { assertCanViewMember } from "../auth/access";
import type { Principal } from "../auth/principal";
import type { TenantClient } from "../tenant-scope";
import { isoWeekday } from "../workouts/expand";
import { dateFromDb, dateToDb } from "../workouts/validate";
import { extendsTimeline } from "./attendance";
import { tenantDate } from "./pagination";
import { STATS_MAX_DAYS, addDays, loadScheduledEntries, parseRange, startOfDay, type ScheduledEntry } from "./schedule";

/** `round(100 * a / b, 1)`, null when b is 0 (docs/PLAN-POC.md section 4). */
export function pct(a: number, b: number): number | null {
  return b === 0 ? null : Math.round((1000 * a) / b) / 10;
}

/** Monday of the ISO week of a date. */
export function weekStartOf(date: string): string {
  return addDays(date, 1 - isoWeekday(date));
}

/**
 * Daily streaks over a set of active days (`YYYY-MM-DD`). `current` = consecutive active days ending
 * today or yesterday (a day without activity yet today does not break the streak); `longest` = longest run.
 */
export function computeStreaks(activeDays: Iterable<string>, today: string): { current: number; longest: number } {
  const days = [...new Set(activeDays)].filter((d) => d <= today).sort();
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of days) {
    run = prev !== null && addDays(prev, 1) === d ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  let current = 0;
  const set = new Set(days);
  let cursor = set.has(today) ? today : addDays(today, -1);
  while (set.has(cursor)) {
    current += 1;
    cursor = addDays(cursor, -1);
  }
  return { current, longest };
}

/** Holiday dates (tenant calendar) as a set. */
export async function holidayDates(db: TenantClient, from: string, to: string): Promise<Set<string>> {
  const rows = await db.holiday.findMany({ where: { date: { gte: dateToDb(from), lte: dateToDb(to) } }, select: { date: true } });
  return new Set(rows.map((h) => dateFromDb(h.date)));
}

/**
 * GET /members/{memberId}/stats (getMemberStats), formulas of docs/PLAN-POC.md 4.2. Attendance counts
 * completed, non-holiday sessions in the range; a miss only counts when it extends the timeline
 * (plain ABSENT on a non-holiday session), so excused absences and holidays never count as missed.
 */
export async function getMemberStats(
  db: TenantClient,
  p: Principal,
  memberId: string,
  params: URLSearchParams,
  now = new Date(),
  /** Entries already loaded for a range that covers [from, to] (STAR-102). */
  preloaded?: ScheduledEntry[] | Promise<ScheduledEntry[]>,
) {
  await assertCanViewMember(db, p, memberId);
  const today = tenantDate(now);
  const { from, to } = parseRange(params, today, { from: -29, to: 0 }, STATS_MAX_DAYS);

  const [attendance, holidays, entries, goalCounts, levelRows, activeGoal, presentRows, doneLogs] = await Promise.all([
    db.attendance.findMany({
      where: { memberId, session: { startsAt: { gte: startOfDay(from), lt: startOfDay(addDays(to, 1)) }, status: "COMPLETED" } },
      select: { status: true, session: { select: { startsAt: true, endsAt: true } } },
    }),
    holidayDates(db, from, to),
    preloaded ? Promise.resolve(preloaded).then((all) => all.filter((e) => e.date >= from && e.date <= to)) : loadScheduledEntries(db, [memberId], from, to),
    db.goal.groupBy({ by: ["status"], where: { memberId }, _count: { _all: true } }),
    db.memberLevel.findMany({
      where: { memberId },
      select: { level: { select: { name: true, rank: true, sportId: true } } },
      orderBy: [{ achievedOn: "desc" }, { level: { rank: "desc" } }],
      take: 1,
    }),
    db.goal.findFirst({ where: { memberId, status: "ACTIVE" }, orderBy: { createdAt: "desc" }, select: { targetSessions: true } }),
    // Streaks read all history, independent of the range, so they join this batch (no second round trip).
    db.attendance.findMany({ where: { memberId, status: "PRESENT" }, select: { session: { select: { startsAt: true } } } }),
    db.workoutLog.findMany({ where: { memberId, status: "COMPLETED" }, select: { scheduledFor: true, completedAt: true } }),
  ]);

  // ---- attendance ----
  let attended = 0;
  let missed = 0;
  let excused = 0;
  let hours = 0;
  const weekly = new Map<string, { attended: number; missed: number; workoutsCompleted: number; workoutsScheduled: number }>();
  const bucket = (date: string) => {
    const k = weekStartOf(date);
    let b = weekly.get(k);
    if (!b) weekly.set(k, (b = { attended: 0, missed: 0, workoutsCompleted: 0, workoutsScheduled: 0 }));
    return b;
  };
  for (let d = weekStartOf(from); d <= to; d = addDays(d, 7)) bucket(d);
  for (const a of attendance) {
    const date = tenantDate(a.session.startsAt);
    const holiday = holidays.has(date);
    if (holiday) continue; // sessions on the holiday calendar count for nothing
    if (a.status === "PRESENT") {
      attended += 1;
      bucket(date).attended += 1;
      hours += (a.session.endsAt.getTime() - a.session.startsAt.getTime()) / 3_600_000;
    } else if (extendsTimeline(a.status, holiday)) {
      missed += 1;
      bucket(date).missed += 1;
    } else if (a.status === "EXCUSED") {
      excused += 1;
    }
  }

  // ---- workouts ----
  let scheduled = 0;
  let completed = 0;
  let skipped = 0;
  let upcoming = 0;
  for (const e of entries) {
    if (e.date > today) {
      upcoming += 1;
      continue;
    }
    scheduled += 1;
    const b = bucket(e.date);
    b.workoutsScheduled += 1;
    if (e.log?.status === "completed") {
      completed += 1;
      b.workoutsCompleted += 1;
    } else if (e.log?.status === "skipped") skipped += 1;
  }

  // ---- streaks: all history, independent of the range ----
  const active = new Set<string>();
  for (const r of presentRows) active.add(tenantDate(r.session.startsAt));
  for (const l of doneLogs) active.add(l.completedAt ? tenantDate(l.completedAt) : dateFromDb(l.scheduledFor));
  const streak = computeStreaks(active, today);

  // ---- level: same rule as getMember's progressPercent ----
  let level: { name: string; rank: number; nextName: string | null; progressPercent: number | null } | null = null;
  const current = levelRows[0]?.level;
  if (current) {
    const [next, top] = await Promise.all([
      db.level.findFirst({ where: { sportId: current.sportId, rank: { gt: current.rank } }, orderBy: { rank: "asc" }, select: { name: true } }),
      db.level.aggregate({ where: { sportId: current.sportId }, _max: { rank: true } }),
    ]);
    let progress = 0;
    if (activeGoal?.targetSessions) {
      const all = await db.attendance.count({ where: { memberId, status: "PRESENT" } });
      progress = Math.min(100, (all / activeGoal.targetSessions) * 100);
    } else if ((top._max.rank ?? 0) > 0) {
      progress = Math.min(100, (current.rank / top._max.rank!) * 100);
    }
    level = { name: current.name, rank: current.rank, nextName: next?.name ?? null, progressPercent: Math.round(progress * 10) / 10 };
  }

  const goalBy = (s: string) => goalCounts.find((g) => g.status === s)?._count._all ?? 0;
  return {
    memberId,
    from,
    to,
    attendance: {
      attended,
      missed,
      excused,
      percent: pct(attended, attended + missed),
      hoursAttended: Math.round(hours * 10) / 10,
    },
    workouts: {
      scheduled,
      completed,
      pending: scheduled - completed - skipped,
      skipped,
      adherencePercent: pct(completed, scheduled),
      upcoming,
    },
    streaks: { currentActiveDays: streak.current, longestActiveDays: streak.longest },
    level,
    goals: { active: goalBy("ACTIVE"), achieved: goalBy("ACHIEVED") },
    weekly: [...weekly.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([weekStart, b]) => ({ weekStart, ...b })),
  };
}
