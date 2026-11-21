import { ApiError } from "../auth/errors";
import type { Principal } from "../auth/principal";
import { attendancePct, loadPercent, round1, slotHours, tallySessions, weekStartOf, pct, type SessionFact } from "../analytics/formulas";
import { loadAttendanceMap, loadSessions } from "../analytics/load";
import type { TenantClient } from "../tenant-scope";
import { dateToDb } from "../workouts/validate";
import { tenantDate } from "./pagination";
import { STATS_MAX_DAYS, addDays, loadScheduledEntries, parseRange, startOfDay } from "./schedule";
import { holidayDates } from "./member-stats";

const DAY_MS = 86_400_000;
const WEEKS = 8;

type Coach = { id: string; name: string };

async function tenantCoaches(db: TenantClient, id?: string): Promise<Coach[]> {
  return db.user.findMany({ where: { role: "COACH", ...(id ? { id } : {}) }, select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }] });
}

/** Members currently enrolled in an active batch of each coach (still active in the tenant). */
async function ownMembers(db: TenantClient, coachIds: string[], today: string) {
  const [batches, enrollments] = await Promise.all([
    db.batch.groupBy({ by: ["coachId"], where: { coachId: { in: coachIds }, isActive: true }, _count: { _all: true } }),
    db.batchMember.findMany({
      where: {
        leftOn: null,
        batch: { coachId: { in: coachIds }, isActive: true },
        member: { isActive: true, OR: [{ leftOn: null }, { leftOn: { gt: dateToDb(today) } }] },
      },
      select: { memberId: true, batch: { select: { coachId: true } } },
    }),
  ]);
  const batchCount = new Map(batches.map((b) => [b.coachId, b._count._all]));
  const members = new Map<string, Set<string>>();
  for (const e of enrollments) {
    const set = members.get(e.batch.coachId) ?? new Set<string>();
    set.add(e.memberId);
    members.set(e.batch.coachId, set);
  }
  return { batchCount, members };
}

/** Plans owned by each coach and the ACTIVE assignments on them, for members still enrolled (two grouped queries). */
async function planCounts(db: TenantClient, coachIds: string[], today: string) {
  const plans = await db.workoutPlan.findMany({ where: { coachId: { in: coachIds } }, select: { id: true, coachId: true, status: true } });
  const groups = plans.length
    ? await db.planAssignment.groupBy({ by: ["planId"], where: { planId: { in: plans.map((p) => p.id) }, status: "ACTIVE", member: { isActive: true, OR: [{ leftOn: null }, { leftOn: { gt: dateToDb(today) } }] } }, _count: { _all: true } })
    : [];
  const perPlan = new Map(groups.map((g) => [g.planId, g._count._all]));
  const activePlans = new Map<string, number>();
  const activeAssignments = new Map<string, number>();
  for (const p of plans) {
    if (p.status === "ACTIVE") activePlans.set(p.coachId, (activePlans.get(p.coachId) ?? 0) + 1);
    activeAssignments.set(p.coachId, (activeAssignments.get(p.coachId) ?? 0) + (perPlan.get(p.id) ?? 0));
  }
  return { activePlans, activeAssignments };
}

/** GET /coaches (listCoaches), owner only. */
export async function listCoaches(db: TenantClient, now = new Date()) {
  const today = tenantDate(now);
  const coaches = await tenantCoaches(db);
  const ids = coaches.map((c) => c.id);
  if (ids.length === 0) return { items: [] };
  const [own, plans, upcoming] = await Promise.all([
    ownMembers(db, ids, today),
    planCounts(db, ids, today),
    db.session.groupBy({
      by: ["coachId"],
      where: { coachId: { in: ids }, status: { not: "CANCELLED" }, startsAt: { gte: now, lt: new Date(now.getTime() + 7 * DAY_MS) } },
      _count: { _all: true },
    }),
  ]);
  const upcomingBy = new Map(upcoming.map((u) => [u.coachId, u._count._all]));
  return {
    items: coaches.map((c) => ({
      id: c.id,
      name: c.name,
      batchCount: own.batchCount.get(c.id) ?? 0,
      memberCount: own.members.get(c.id)?.size ?? 0,
      upcomingSessions7d: upcomingBy.get(c.id) ?? 0,
      activeAssignments: plans.activeAssignments.get(c.id) ?? 0,
    })),
  };
}

/**
 * CoachStats for the given coaches over [from, to] (PLAN-POC 4.2), computed with grouped queries for
 * all coaches at once: sessions, attendance, availability, plans, goals and level promotions.
 */
export async function buildCoachStats(db: TenantClient, coaches: Coach[], from: string, to: string, now: Date) {
  if (coaches.length === 0) return [];
  const today = tenantDate(now);
  const ids = coaches.map((c) => c.id);
  const weekStart0 = addDays(weekStartOf(today), -7 * (WEEKS - 1));
  const lo = from < weekStart0 ? from : weekStart0;
  const hiBase = to > addDays(today, 8) ? to : addDays(today, 8);
  const next7 = new Date(now.getTime() + 7 * DAY_MS);
  const rangeStart = startOfDay(from);
  const rangeEnd = startOfDay(addDays(to, 1));

  const [sessions, att, holidays, own, plans, availability] = await Promise.all([
    loadSessions(db, lo, hiBase, ids),
    loadAttendanceMap(db, lo, hiBase, ids),
    holidayDates(db, lo, hiBase),
    ownMembers(db, ids, today),
    planCounts(db, ids, today),
    db.coachAvailability.findMany({ where: { coachId: { in: ids } }, select: { coachId: true, startTime: true, endTime: true } }),
  ]);

  const allMemberIds = [...new Set([...own.members.values()].flatMap((s) => [...s]))];
  const workoutTo = to < today ? to : today;
  const [entries, achieved, active, promotions] = await Promise.all([
    from <= workoutTo ? loadScheduledEntries(db, allMemberIds, from, workoutTo) : Promise.resolve([]),
    allMemberIds.length
      ? db.goal.groupBy({ by: ["memberId"], where: { memberId: { in: allMemberIds }, status: "ACHIEVED", updatedAt: { gte: rangeStart, lt: rangeEnd } }, _count: { _all: true } })
      : Promise.resolve([]),
    allMemberIds.length
      ? db.goal.groupBy({ by: ["memberId"], where: { memberId: { in: allMemberIds }, status: "ACTIVE" }, _count: { _all: true } })
      : Promise.resolve([]),
    db.memberLevel.groupBy({ by: ["awardedById"], where: { awardedById: { in: ids }, achievedOn: { gte: dateToDb(from), lte: dateToDb(to) } }, _count: { _all: true } }),
  ]);
  const achievedBy = new Map(achieved.map((g) => [g.memberId, g._count._all]));
  const activeBy = new Map(active.map((g) => [g.memberId, g._count._all]));
  const promoBy = new Map(promotions.map((g) => [g.awardedById, g._count._all]));
  const entriesByMember = new Map<string, { scheduled: number; completed: number }>();
  for (const e of entries) {
    const t = entriesByMember.get(e.memberId) ?? { scheduled: 0, completed: 0 };
    t.scheduled += 1;
    if (e.log?.status === "completed") t.completed += 1;
    entriesByMember.set(e.memberId, t);
  }
  const hoursBy = new Map<string, number>();
  for (const a of availability) hoursBy.set(a.coachId, (hoursBy.get(a.coachId) ?? 0) + slotHours(a.startTime, a.endTime));

  return coaches.map((c) => {
    const mine = sessions.filter((s) => s.coachId === c.id);
    const inRange = mine.filter((s) => s.date >= from && s.date <= to);
    const t = tallySessions(inRange, att, holidays, now);

    const upcoming = mine.filter((s) => s.status !== "CANCELLED" && s.startsAt >= now && s.startsAt < next7);
    const bookedHours = upcoming.reduce((h, s) => h + (s.endsAt.getTime() - s.startsAt.getTime()) / 3_600_000, 0);
    const availHours = hoursBy.get(c.id) ?? 0;

    const memberIds = [...(own.members.get(c.id) ?? [])];
    let wScheduled = 0;
    let wCompleted = 0;
    let goalsAchieved = 0;
    let goalsActive = 0;
    for (const m of memberIds) {
      const e = entriesByMember.get(m);
      wScheduled += e?.scheduled ?? 0;
      wCompleted += e?.completed ?? 0;
      goalsAchieved += achievedBy.get(m) ?? 0;
      goalsActive += activeBy.get(m) ?? 0;
    }

    const weekly = Array.from({ length: WEEKS }, (_, i) => {
      const weekStart = addDays(weekStart0, 7 * i);
      const weekEnd = addDays(weekStart, 6);
      const w = tallySessions(mine.filter((s: SessionFact) => s.date >= weekStart && s.date <= weekEnd), att, holidays, now);
      return { weekStart, scheduled: w.scheduled, completed: w.completed, attendancePercent: attendancePct(w) };
    });

    return {
      coachId: c.id,
      coachName: c.name,
      from,
      to,
      batchCount: own.batchCount.get(c.id) ?? 0,
      memberCount: memberIds.length,
      sessions: { scheduled: t.scheduled, completed: t.completed, cancelled: t.cancelled, unlogged: t.unlogged, upcoming7d: upcoming.length },
      consistencyPercent: pct(t.completed, t.scheduled),
      attendancePercent: attendancePct(t),
      workoutAdherencePercent: pct(wCompleted, wScheduled),
      activeAssignments: plans.activeAssignments.get(c.id) ?? 0,
      activePlans: plans.activePlans.get(c.id) ?? 0,
      availabilityHoursPerWeek: round1(availHours),
      bookedHoursNext7d: round1(bookedHours),
      loadPercent: loadPercent(bookedHours, availHours),
      memberOutcomes: { goalsAchieved, goalsActive, levelPromotions: promoBy.get(c.id) ?? 0 },
      weekly,
    };
  });
}

/** GET /coaches/{coachId}/stats (getCoachStats): owner any coach, coach self only. 404 outside the tenant. */
export async function getCoachStats(db: TenantClient, p: Principal, coachId: string, params: URLSearchParams, now = new Date()) {
  const coach = (await tenantCoaches(db, coachId))[0];
  if (!coach) throw new ApiError("not_found", "Coach not found");
  if (p.role === "coach" && coach.id !== p.userId) throw new ApiError("forbidden", "Coaches can only see their own record");
  const { from, to } = parseRange(params, tenantDate(now), { from: -29, to: 0 }, STATS_MAX_DAYS);
  return (await buildCoachStats(db, [coach], from, to, now))[0];
}

export { tenantCoaches };
