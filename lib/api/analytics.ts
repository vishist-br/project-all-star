import { cache } from "react";
import { ApiError } from "../auth/errors";
import {
  absenceRun,
  attendanceBy,
  attendancePct,
  buildCards,
  countActive,
  countJoined,
  countLeft,
  FOLLOW_UP_ABSENCES,
  FOLLOW_UP_INACTIVE_DAYS,
  isActiveOn,
  joinCohorts,
  kpi,
  netGrowthPercent,
  noShowPct,
  pct,
  previousPeriod,
  retentionPercent,
  tallySessions,
  UNLOGGED_AFTER_MS,
  weekdayOf,
  weekStartOf,
  workoutsPending,
  type MemberLife,
  type SessionFact,
} from "../analytics/formulas";
import { loadAttendanceMap, loadMembers, loadSessions, type MemberRow } from "../analytics/load";
import type { TenantClient } from "../tenant-scope";
import { dateToDb } from "../workouts/validate";
import { buildCoachStats, tenantCoaches } from "./coaches";
import { sharedHolidayDates, sharedScheduledEntries } from "./request-shared";
import { enumParam, tenantDate } from "./pagination";
import { STATS_MAX_DAYS, addDays, parseRange, spanDays, startOfDay, type ScheduledEntry } from "./schedule";

const DAY_MS = 86_400_000;
const ENGAGED_DAYS = 14;
const LOOKBACK_DAYS = 60;
const MAX_FOLLOW_UPS = 20;
const MAX_RENEWALS = 50;
const MAX_UNLOGGED = 50;

const lifeOf = (m: MemberRow): MemberLife => m;
const dayRange = (from: string, to: string) => ({ gte: startOfDay(from), lt: startOfDay(addDays(to, 1)) });

/** Workout entries counted for a member only on days they were enrolled in the tenant. */
function aliveEntries(entries: ScheduledEntry[], life: Map<string, MemberRow>) {
  return entries.filter((e) => {
    const m = life.get(e.memberId);
    return !!m && m.joinedOn <= e.date && (m.leftOn === null || m.leftOn > e.date);
  });
}

function workoutTally(entries: readonly ScheduledEntry[], from: string, to: string) {
  let scheduled = 0;
  let completed = 0;
  for (const e of entries) {
    if (e.date < from || e.date > to) continue;
    scheduled += 1;
    if (e.log?.status === "completed") completed += 1;
  }
  return { scheduled, completed };
}

/** Members with a PRESENT mark or a COMPLETED workout in the 14 days ending `end`, who are active on `end`. */
async function engagedMembers(db: TenantClient, members: MemberRow[], end: string, today: string): Promise<number> {
  const start = addDays(end, -(ENGAGED_DAYS - 1));
  const [present, logs] = await Promise.all([
    db.attendance.findMany({ where: { status: "PRESENT", session: { startsAt: dayRange(start, end) } }, select: { memberId: true }, distinct: ["memberId"] }),
    db.workoutLog.findMany({ where: { status: "COMPLETED", scheduledFor: { gte: dateToDb(start), lte: dateToDb(end) } }, select: { memberId: true }, distinct: ["memberId"] }),
  ]);
  const engaged = new Set([...present.map((r) => r.memberId), ...logs.map((r) => r.memberId)]);
  return members.filter((m) => engaged.has(m.id) && isActiveOn(m, end, today)).length;
}

type Facts = {
  members: MemberRow[];
  sessions: SessionFact[];
  att: Awaited<ReturnType<typeof loadAttendanceMap>>;
  holidays: Set<string>;
  entries: ScheduledEntry[];
};

function periodNumbers(f: Facts, from: string, to: string, today: string, now: Date, engaged: number) {
  const life = f.members.map(lifeOf);
  const t = tallySessions(f.sessions.filter((s) => s.date >= from && s.date <= to), f.att, f.holidays, now);
  const active = countActive(life, to, today);
  const w = workoutTally(f.entries, from, to);
  return {
    active,
    new: countJoined(life, from, to),
    left: countLeft(life, from, to),
    net: netGrowthPercent(life, from, to, today),
    ...t,
    completion: pct(t.completed, t.scheduled),
    attendance: attendancePct(t),
    noShow: noShowPct(t),
    engaged,
    engagedPercent: pct(engaged, active),
    wScheduled: w.scheduled,
    wCompleted: w.completed,
    adherence: pct(w.completed, w.scheduled),
    retention: retentionPercent(life, from, to, today),
  };
}

/** Everything behind getOwnerOverview; the insights endpoint reuses the same numbers. */
/**
 * Memoised per request (React cache, keyed by db client, range and instant): the dashboard asks for
 * the overview and the insights, which both need the same 30-day overview, so it runs once. Outside
 * a React render (API routes, tests) cache() is a pass-through.
 */
export function computeOverview(db: TenantClient, from: string, to: string, now: Date) {
  return computeOverviewOnce(db, from, to, now.getTime());
}

const computeOverviewOnce = cache((db: TenantClient, from: string, to: string, nowMs: number) => computeOverviewUncached(db, from, to, new Date(nowMs)));

async function computeOverviewUncached(db: TenantClient, from: string, to: string, now: Date) {
  const today = tenantDate(now);
  const prev = previousPeriod(from, to);
  const [members, sessions, att, holidays, batches] = await Promise.all([
    loadMembers(db),
    loadSessions(db, prev.from, to),
    loadAttendanceMap(db, prev.from, to),
    sharedHolidayDates(db, today, prev.from, to),
    db.batch.findMany({ select: { id: true, name: true, kind: true, capacity: true } }),
  ]);
  const life = new Map(members.map((m) => [m.id, m]));
  const workoutTo = to < today ? to : today;
  const [rawEntries, engagedNow, engagedPrev, assignments, bookingGroups] = await Promise.all([
    prev.from <= workoutTo ? sharedScheduledEntries(db, today, members.map((m) => m.id), members.map((m) => m.id), prev.from, workoutTo) : Promise.resolve([]),
    engagedMembers(db, members, to, today),
    engagedMembers(db, members, prev.to, today),
    db.planAssignment.groupBy({
      by: ["memberId"],
      where: { status: "ACTIVE", startsOn: { lte: dateToDb(to) }, OR: [{ endsOn: null }, { endsOn: { gte: dateToDb(to) } }] },
      _count: { _all: true },
    }),
    db.sessionBooking.groupBy({ by: ["sessionId", "status"], where: { session: { startsAt: dayRange(from, to) } }, _count: { _all: true } }),
  ]);
  const f: Facts = { members, sessions, att, holidays, entries: aliveEntries(rawEntries, life) };
  const cur = periodNumbers(f, from, to, today, now, engagedNow);
  const old = periodNumbers(f, prev.from, prev.to, today, now, engagedPrev);

  // Attendance patterns, current period only.
  const inPeriod = sessions.filter((s) => s.date >= from && s.date <= to);
  const weekdayBuckets = attendanceBy(inPeriod, att, holidays, now, (s) => String(weekdayOf(s.date)));
  const byWeekday = [1, 2, 3, 4, 5, 6, 7].map((weekday) => {
    const b = weekdayBuckets.get(String(weekday));
    return { weekday, percent: b ? attendancePct(b) : null, noShowPercent: b ? noShowPct(b) : null, sessions: b?.sessions ?? 0 };
  });
  const batchBuckets = attendanceBy(inPeriod, att, holidays, now, (s) => s.batchId);
  const batchName = new Map(batches.map((b) => [b.id, b.name]));
  const byBatch = [...batchBuckets.entries()]
    .map(([batchId, b]) => ({ batchId, batchName: batchName.get(batchId) ?? "", sessions: b.sessions, percent: attendancePct(b), noShowPercent: noShowPct(b) }))
    .sort((a, b) => a.batchName.localeCompare(b.batchName) || a.batchId.localeCompare(b.batchId));

  // Plans: ACTIVE assignments at `to` of members who are still enrolled.
  const planned = assignments.filter((g) => {
    const m = life.get(g.memberId);
    return !!m && isActiveOn(m, to, today);
  });
  const activeAssignments = planned.reduce((n, g) => n + g._count._all, 0);

  // Bookings in the period; fill = booked seats over capacity of capped group classes.
  const bookedBySession = new Map<string, number>();
  let booked = 0;
  let waitlisted = 0;
  let cancelled = 0;
  for (const g of bookingGroups) {
    const n = g._count._all;
    if (g.status === "BOOKED") {
      booked += n;
      bookedBySession.set(g.sessionId, n);
    } else if (g.status === "WAITLISTED") waitlisted += n;
    else cancelled += n;
  }
  const batchBy = new Map(batches.map((b) => [b.id, b]));
  let capacity = 0;
  let seatsTaken = 0;
  for (const s of inPeriod) {
    const b = batchBy.get(s.batchId);
    if (!b || b.kind !== "GROUP_CLASS" || s.status === "CANCELLED" || holidays.has(s.date)) continue;
    const cap = s.capacity ?? b.capacity; // a session may override the batch capacity
    if (cap === null) continue;
    capacity += cap;
    seatsTaken += bookedBySession.get(s.id) ?? 0;
  }

  // Coaches: scheduled vs completed per coach, for the insight cards.
  const coachSessions = new Map<string, { scheduled: number; completed: number }>();
  for (const coachId of new Set(inPeriod.map((s) => s.coachId))) {
    const t = tallySessions(inPeriod.filter((s) => s.coachId === coachId), att, holidays, now);
    coachSessions.set(coachId, { scheduled: t.scheduled, completed: t.completed });
  }

  const dto = {
    from,
    to,
    members: {
      active: kpi(cur.active, old.active),
      new: kpi(cur.new, old.new),
      left: kpi(cur.left, old.left),
      netGrowthPercent: kpi(cur.net, old.net),
    },
    sessions: {
      scheduled: kpi(cur.scheduled, old.scheduled),
      completed: kpi(cur.completed, old.completed),
      cancelled: kpi(cur.cancelled, old.cancelled),
      unlogged: kpi(cur.unlogged, old.unlogged),
      completionPercent: kpi(cur.completion, old.completion),
    },
    attendance: {
      percent: kpi(cur.attendance, old.attendance),
      noShowPercent: kpi(cur.noShow, old.noShow),
      byWeekday,
      byBatch,
    },
    engagement: { engagedMembers: kpi(cur.engaged, old.engaged), percent: kpi(cur.engagedPercent, old.engagedPercent) },
    workouts: {
      scheduled: kpi(cur.wScheduled, old.wScheduled),
      completed: kpi(cur.wCompleted, old.wCompleted),
      adherencePercent: kpi(cur.adherence, old.adherence),
      activeAssignments: kpi(activeAssignments),
      membersWithPlan: kpi(planned.length),
    },
    retention: { percent: kpi(cur.retention, old.retention), cohorts: joinCohorts(members.map(lifeOf), today) },
    bookings: { booked, waitlisted, cancelled, fillPercent: pct(seatsTaken, capacity) },
  };
  return { dto, coachSessions, members };
}

/** The contract's default period: the last 30 days ending today, at most a year. */
function range(params: URLSearchParams, now: Date) {
  return parseRange(params, tenantDate(now), { from: -29, to: 0 }, STATS_MAX_DAYS);
}

/** GET /analytics/overview (getOwnerOverview). */
export async function getOwnerOverview(db: TenantClient, params: URLSearchParams, now = new Date()) {
  const { from, to } = range(params, now);
  return (await computeOverview(db, from, to, now)).dto;
}

// ---------------------------------------------------------------------------------------------
// Trends
// ---------------------------------------------------------------------------------------------

function parsePeriods(params: URLSearchParams): number {
  const raw = params.get("periods");
  if (raw === null || raw === "") return 12;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 2 || n > 24) {
    throw new ApiError("validation_failed", "periods must be an integer between 2 and 24", [{ field: "periods", message: "Integer 2..24" }]);
  }
  return n;
}

function monthStart(date: string, delta: number): string {
  const [y, m] = date.split("-").map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}-01`;
}

/**
 * GET /analytics/trends (getOwnerTrends). Buckets end with the current week or month. Engaged
 * members of a bucket = members active at its end with a PRESENT mark or a COMPLETED workout in it.
 */
export async function getOwnerTrends(db: TenantClient, params: URLSearchParams, now = new Date()) {
  const granularity = enumParam(params, "granularity", ["week", "month"] as const) ?? "week";
  const periods = parsePeriods(params);
  const today = tenantDate(now);

  const starts = Array.from({ length: periods }, (_, i) => {
    const back = periods - 1 - i;
    return granularity === "week" ? addDays(weekStartOf(today), -7 * back) : monthStart(today, -back);
  });
  const buckets = starts.map((start, i) => {
    const next = i + 1 < starts.length ? starts[i + 1] : granularity === "week" ? addDays(start, 7) : monthStart(start, 1);
    const end = addDays(next, -1);
    return { start, end, effectiveEnd: end < today ? end : today };
  });
  const first = starts[0];

  const [members, sessions, att, holidays, presentRows] = await Promise.all([
    loadMembers(db),
    loadSessions(db, first, today),
    loadAttendanceMap(db, first, today),
    sharedHolidayDates(db, today, first, today),
    db.attendance.findMany({ where: { status: "PRESENT", session: { startsAt: dayRange(first, today) } }, select: { memberId: true, session: { select: { startsAt: true } } } }),
  ]);
  const life = new Map(members.map((m) => [m.id, m]));
  const entries = aliveEntries(await sharedScheduledEntries(db, today, members.map((m) => m.id), members.map((m) => m.id), first, today), life);
  const lifeRows = members.map(lifeOf);

  const points = buckets.map((b) => {
    const t = tallySessions(sessions.filter((s) => s.date >= b.start && s.date <= b.end), att, holidays, now);
    const w = workoutTally(entries, b.start, b.end);
    const engaged = new Set<string>();
    for (const r of presentRows) {
      const d = tenantDate(r.session.startsAt);
      if (d >= b.start && d <= b.end) engaged.add(r.memberId);
    }
    for (const e of entries) if (e.date >= b.start && e.date <= b.end && e.log?.status === "completed") engaged.add(e.memberId);
    return {
      periodStart: b.start,
      activeMembers: countActive(lifeRows, b.effectiveEnd, today),
      newMembers: countJoined(lifeRows, b.start, b.end),
      leftMembers: countLeft(lifeRows, b.start, b.end),
      sessionsScheduled: t.scheduled,
      sessionsCompleted: t.completed,
      attendancePercent: attendancePct(t),
      workoutsCompleted: w.completed,
      workoutsScheduled: w.scheduled,
      engagedMembers: [...engaged].filter((id) => isActiveOn(life.get(id)!, b.effectiveEnd, today)).length,
    };
  });
  return { granularity, points };
}

// ---------------------------------------------------------------------------------------------
// Coach workload, fees
// ---------------------------------------------------------------------------------------------

/** GET /analytics/coaches (getCoachWorkload). */
export async function getCoachWorkload(db: TenantClient, params: URLSearchParams, now = new Date()) {
  const { from, to } = range(params, now);
  return { from, to, items: await buildCoachStats(db, await tenantCoaches(db), from, to, now) };
}

/** GET /analytics/fees (getFeeStats): counts only, there are no amounts in the data. */
export async function getFeeStats(db: TenantClient, now = new Date()) {
  const today = tenantDate(now);
  const asOf = dateToDb(today);
  const active = { isActive: true, joinedOn: { lte: asOf }, OR: [{ leftOn: null }, { leftOn: { gt: asOf } }] };
  const thisMonth = dateToDb(monthStart(today, 0));
  const nextMonth = dateToDb(monthStart(today, 1));
  const [byStatus, paidByMethod, dueSoon, paidThisMonth] = await Promise.all([
    db.member.groupBy({ by: ["feeStatus"], where: active, _count: { _all: true } }),
    db.member.groupBy({ by: ["feePaidMethod"], where: { ...active, feeStatus: "PAID" }, _count: { _all: true } }),
    db.member.count({ where: { ...active, feeStatus: "DUE", feeDueOn: { gte: asOf, lte: dateToDb(addDays(today, 7)) } } }),
    db.member.count({ where: { ...active, feePaidOn: { gte: thisMonth, lt: nextMonth } } }),
  ]);
  const n = (s: string) => byStatus.find((g) => g.feeStatus === s)?._count._all ?? 0;
  const method = (m: string | null) => paidByMethod.find((g) => g.feePaidMethod === m)?._count._all ?? 0;
  const counts = { paid: n("PAID"), due: n("DUE"), overdue: n("OVERDUE"), waived: n("WAIVED") };
  const activeMembers = counts.paid + counts.due + counts.overdue + counts.waived;
  return {
    asOf: today,
    activeMembers,
    counts,
    dueNext7Days: dueSoon,
    paidThisMonth,
    paidByMethod: { cash: method("CASH"), upi: method("UPI"), unknown: method(null) },
    paidPercent: pct(counts.paid, activeMembers - counts.waived),
  };
}

// ---------------------------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------------------------

type FollowUp = { memberId: string; memberName: string; reason: "consecutive_absences" | "inactive_14_days" | "workouts_pending"; detail: number; rank: number; severity: number };

/** GET /analytics/insights (getOwnerInsights): follow-ups, renewals, unlogged sessions and rule-based cards. */
export async function getOwnerInsights(db: TenantClient, now = new Date()) {
  const today = tenantDate(now);
  const p30 = { from: addDays(today, -29), to: today };
  const lookFrom = addDays(today, -(LOOKBACK_DAYS - 1));
  const winFrom = addDays(today, -(FOLLOW_UP_INACTIVE_DAYS - 1));

  const [{ dto: overview, coachSessions, members }, holidays, markRows, lastLogs] = await Promise.all([
    computeOverview(db, p30.from, p30.to, now),
    sharedHolidayDates(db, today, lookFrom, today),
    db.attendance.findMany({
      where: { session: { status: "COMPLETED", startsAt: dayRange(lookFrom, today) } },
      select: { memberId: true, status: true, session: { select: { startsAt: true } } },
      orderBy: [{ session: { startsAt: "desc" } }, { id: "asc" }],
    }),
    db.workoutLog.groupBy({ by: ["memberId"], where: { status: "COMPLETED", scheduledFor: { gte: dateToDb(lookFrom), lte: dateToDb(today) } }, _max: { scheduledFor: true } }),
  ]);
  const life = new Map(members.map((m) => [m.id, m]));
  const activeNow = members.filter((m) => isActiveOn(m, today, today));
  const activeIds = new Set(activeNow.map((m) => m.id));

  // Attendance per member, newest first, holidays skipped.
  const marks = new Map<string, { status: string; date: string }[]>();
  for (const r of markRows) {
    if (!activeIds.has(r.memberId)) continue;
    const date = tenantDate(r.session.startsAt);
    if (holidays.has(date)) continue;
    const list = marks.get(r.memberId) ?? [];
    list.push({ status: r.status, date });
    marks.set(r.memberId, list);
  }
  const lastActive = new Map<string, string>();
  for (const [id, list] of marks) {
    const present = list.find((x) => x.status === "PRESENT");
    if (present) lastActive.set(id, present.date);
  }
  for (const g of lastLogs) {
    const d = g._max.scheduledFor?.toISOString().slice(0, 10);
    if (d && d > (lastActive.get(g.memberId) ?? "")) lastActive.set(g.memberId, d);
  }

  const entries = aliveEntries(await sharedScheduledEntries(db, today, members.map((m) => m.id), [...activeIds], winFrom, today), life);
  const perMember = new Map<string, { scheduled: number; completed: number }>();
  for (const e of entries) {
    const t = perMember.get(e.memberId) ?? { scheduled: 0, completed: 0 };
    t.scheduled += 1;
    if (e.log?.status === "completed") t.completed += 1;
    perMember.set(e.memberId, t);
  }

  // One follow-up per member, the first rule that applies: absences, inactivity, pending workouts.
  const followUps: FollowUp[] = [];
  for (const m of activeNow) {
    const run = absenceRun((marks.get(m.id) ?? []).map((x) => x.status));
    if (run >= FOLLOW_UP_ABSENCES) {
      followUps.push({ memberId: m.id, memberName: m.displayName, reason: "consecutive_absences", detail: run, rank: 0, severity: -run });
      continue;
    }
    const last = lastActive.get(m.id);
    if (m.joinedOn < addDays(today, -FOLLOW_UP_INACTIVE_DAYS) && (!last || last < winFrom)) {
      const days = last ? spanDays(last, today) - 1 : LOOKBACK_DAYS;
      followUps.push({ memberId: m.id, memberName: m.displayName, reason: "inactive_14_days", detail: days, rank: 1, severity: -days });
      continue;
    }
    const w = perMember.get(m.id);
    const pending = w ? workoutsPending(w.scheduled, w.completed) : null;
    if (pending !== null) {
      followUps.push({ memberId: m.id, memberName: m.displayName, reason: "workouts_pending", detail: Math.round(pending), rank: 2, severity: pending });
    }
  }
  followUps.sort((a, b) => a.rank - b.rank || a.severity - b.severity || a.memberName.localeCompare(b.memberName) || a.memberId.localeCompare(b.memberId));
  const shown = followUps.slice(0, MAX_FOLLOW_UPS);
  const enrol = shown.length
    ? await db.batchMember.findMany({
        where: { memberId: { in: shown.map((f) => f.memberId) }, leftOn: null, batch: { isActive: true } },
        select: { memberId: true, batch: { select: { coach: { select: { name: true } } } } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      })
    : [];
  const coachOf = new Map<string, string>();
  for (const e of enrol) if (!coachOf.has(e.memberId)) coachOf.set(e.memberId, e.batch.coach.name);

  // Renewals: overdue, or due within 7 days, with attendance of the last 30 days.
  const horizon = addDays(today, 7);
  const feeRows = await db.member.findMany({
    where: {
      id: { in: [...activeIds] },
      OR: [{ feeStatus: "OVERDUE" }, { feeStatus: "DUE", feeDueOn: { lte: dateToDb(horizon) } }],
    },
    select: { id: true, displayName: true, feeStatus: true, feeDueOn: true },
  });
  const att30 = feeRows.length
    ? await db.attendance.findMany({
        where: { memberId: { in: feeRows.map((r) => r.id) }, session: { status: "COMPLETED", startsAt: dayRange(p30.from, today) } },
        select: { memberId: true, status: true, session: { select: { startsAt: true } } },
      })
    : [];
  const holidays30 = await sharedHolidayDates(db, today, p30.from, today);
  const tally = new Map<string, { present: number; absent: number }>();
  for (const r of att30) {
    if (holidays30.has(tenantDate(r.session.startsAt)) || r.status === "EXCUSED") continue;
    const t = tally.get(r.memberId) ?? { present: 0, absent: 0 };
    if (r.status === "PRESENT") t.present += 1;
    else t.absent += 1;
    tally.set(r.memberId, t);
  }
  const renewals = feeRows
    .map((r) => ({
      memberId: r.id,
      memberName: r.displayName,
      feeStatus: r.feeStatus === "OVERDUE" ? ("overdue" as const) : ("due" as const),
      feeDueOn: r.feeDueOn ? r.feeDueOn.toISOString().slice(0, 10) : null,
      attendancePercent30d: tally.has(r.id) ? attendancePct(tally.get(r.id)!) : null,
    }))
    .sort((a, b) => (a.feeStatus === b.feeStatus ? 0 : a.feeStatus === "overdue" ? -1 : 1) || (a.feeDueOn ?? "9999").localeCompare(b.feeDueOn ?? "9999") || a.memberName.localeCompare(b.memberName))
    .slice(0, MAX_RENEWALS);

  // Unlogged sessions: no roll call 2 hours after the end, last 14 days.
  const unloggedRows = await db.session.findMany({
    where: { status: "SCHEDULED", endsAt: { lt: new Date(now.getTime() - UNLOGGED_AFTER_MS) }, startsAt: { gte: new Date(now.getTime() - 14 * DAY_MS) } },
    select: { id: true, startsAt: true, batch: { select: { name: true, kind: true } }, coach: { select: { name: true } } },
    orderBy: [{ startsAt: "desc" }, { id: "asc" }],
  });
  const holidays14 = await sharedHolidayDates(db, today, addDays(today, -15), today);
  const unloggedSessions = unloggedRows
    .filter((s) => !holidays14.has(tenantDate(s.startsAt)))
    .slice(0, MAX_UNLOGGED)
    .map((s) => ({ sessionId: s.id, batchName: s.batch.name, coachName: s.coach.name, startsAt: s.startsAt.toISOString(), isGroupClass: s.batch.kind === "GROUP_CLASS" }));

  const cards = buildCards({
    attendancePercent: overview.attendance.percent.value,
    previousAttendancePercent: overview.attendance.percent.previous,
    byWeekday: overview.attendance.byWeekday,
    newMembers: overview.members.new.value ?? 0,
    coaches: [...coachSessions.values()],
    adherencePercent: overview.workouts.adherencePercent.value,
    membersWithPlan: overview.workouts.membersWithPlan.value ?? 0,
    followUpCount: followUps.length,
  });

  return {
    generatedAt: now.toISOString(),
    followUps: shown.map((f) => ({ memberId: f.memberId, memberName: f.memberName, reason: f.reason, detail: f.detail, coachName: coachOf.get(f.memberId) ?? null })),
    renewals,
    unloggedSessions,
    cards,
  };
}

export type OwnerOverview = Awaited<ReturnType<typeof getOwnerOverview>>;
