import { assertCanViewMember } from "../auth/access";
import { ApiError } from "../auth/errors";
import type { Principal } from "../auth/principal";
import type { TenantClient } from "../tenant-scope";
import { expandSchedule, logKey, type Cadence } from "../workouts/expand";
import { dateFromDb, dateToDb, isDateString } from "../workouts/validate";
import { tenantDate } from "./pagination";
import { dateOnly } from "./session-detail";

export const SCHEDULE_MAX_DAYS = 62;
export const STATS_MAX_DAYS = 366;

export function addDays(date: string, n: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
}

/** Inclusive number of days in [from, to]. */
export function spanDays(from: string, to: string): number {
  return Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000) + 1;
}

export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Start instant of a tenant-timezone date (all POC tenants are Asia/Kolkata). */
export function startOfDay(date: string): Date {
  return new Date(`${date}T00:00:00+05:30`);
}

/** `from` / `to` query params as `YYYY-MM-DD`, with defaults relative to today and a maximum span. */
export function parseRange(
  params: URLSearchParams,
  today: string,
  defaults: { from: number; to: number },
  maxDays: number,
): { from: string; to: string } {
  const read = (name: string, fallback: string) => {
    const v = params.get(name);
    if (v === null || v === "") return fallback;
    if (!isDateString(v)) {
      throw new ApiError("validation_failed", `${name} must be a date (YYYY-MM-DD)`, [{ field: name, message: "Date YYYY-MM-DD" }]);
    }
    return v;
  };
  const hasFrom = !!params.get("from");
  const hasTo = !!params.get("to");
  // A lone `from` or `to` keeps the default span length on its other side.
  let from = read("from", addDays(today, defaults.from));
  let to = read("to", addDays(today, defaults.to));
  if (hasFrom && !hasTo) to = addDays(from, defaults.to - defaults.from);
  if (hasTo && !hasFrom) from = addDays(to, defaults.from - defaults.to);
  if (to < from) throw new ApiError("validation_failed", "to must not be before from", [{ field: "to", message: "Must not be before from" }]);
  if (spanDays(from, to) > maxDays) {
    throw new ApiError("validation_failed", `The range is at most ${maxDays} days`, [{ field: "to", message: `At most ${maxDays} days` }]);
  }
  return { from, to };
}

export type ItemStatus = "pending" | "started" | "stopped" | "completed" | "skipped";

export type ScheduledEntry = {
  memberId: string;
  date: string;
  assignmentId: string;
  planId: string;
  planTitle: string;
  dayTitle: string | null;
  item: {
    id: string;
    exerciseId: string;
    exerciseName: string;
    position: number;
    sets: number | null;
    reps: number | null;
    durationSeconds: number | null;
    restSeconds: number | null;
    notes: string | null;
  };
  log: { id: string; status: ItemStatus; completedAt: Date | null } | null;
};

/**
 * Expanded workout items (docs/PLAN-POC.md 2.5) of the given members on [from, to], with the log
 * for each item and date when one exists. ACTIVE and ENDED assignments schedule (an ended one up
 * to its `endsOn`); PAUSED ones schedule nothing.
 */
export async function loadScheduledEntries(db: TenantClient, memberIds: string[], from: string, to: string): Promise<ScheduledEntry[]> {
  if (memberIds.length === 0) return [];
  const assignments = await db.planAssignment.findMany({
    where: {
      memberId: { in: memberIds },
      status: { not: "PAUSED" },
      startsOn: { lte: dateToDb(to) },
      OR: [{ endsOn: null }, { endsOn: { gte: dateToDb(from) } }],
    },
    include: { plan: { select: { id: true, title: true, cadence: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (assignments.length === 0) return [];

  const planIds = [...new Set(assignments.map((a) => a.planId))];
  const days = await db.workoutPlanDay.findMany({
    where: { planId: { in: planIds } },
    include: {
      items: { include: { exercise: { select: { id: true, name: true } } }, orderBy: [{ position: "asc" }, { id: "asc" }] },
    },
  });
  const daysByPlan = new Map<string, typeof days>();
  for (const d of days) daysByPlan.set(d.planId, [...(daysByPlan.get(d.planId) ?? []), d]);

  const logs = await db.workoutLog.findMany({
    where: { assignmentId: { in: assignments.map((a) => a.id) }, scheduledFor: { gte: dateToDb(from), lte: dateToDb(to) } },
    select: { id: true, assignmentId: true, planItemId: true, scheduledFor: true, status: true, completedAt: true },
  });
  const logBy = new Map(logs.map((l) => [`${l.assignmentId}|${logKey(l.planItemId, dateFromDb(l.scheduledFor))}`, l]));

  const out: ScheduledEntry[] = [];
  for (const a of assignments) {
    const planDays = daysByPlan.get(a.planId) ?? [];
    const logged = new Set(
      logs.filter((l) => l.assignmentId === a.id).map((l) => logKey(l.planItemId, dateFromDb(l.scheduledFor))),
    );
    const endsOn = a.endsOn ? dateFromDb(a.endsOn) : a.status === "ENDED" ? tenantDate(a.updatedAt) : null;
    const scheduled = expandSchedule(
      { status: "active", startsOn: dateFromDb(a.startsOn), endsOn },
      { cadence: a.plan.cadence.toLowerCase() as Cadence, days: planDays.map((d) => ({ dayIndex: d.dayIndex, items: d.items })) },
      from,
      to,
      logged,
    );
    const titles = new Map(planDays.map((d) => [d.dayIndex, d.title]));
    for (const day of scheduled) {
      for (const it of day.items) {
        const l = logBy.get(`${a.id}|${logKey(it.id, day.date)}`);
        out.push({
          memberId: a.memberId,
          date: day.date,
          assignmentId: a.id,
          planId: a.planId,
          planTitle: a.plan.title,
          dayTitle: titles.get(day.dayIndex) ?? null,
          item: {
            id: it.id,
            exerciseId: it.exerciseId,
            exerciseName: it.exercise.name,
            position: it.position,
            sets: it.sets,
            reps: it.reps,
            durationSeconds: it.durationSeconds,
            restSeconds: it.restSeconds,
            notes: it.notes,
          },
          log: l ? { id: l.id, status: l.status.toLowerCase() as ItemStatus, completedAt: l.completedAt } : null,
        });
      }
    }
  }
  return out;
}

type SessionDtoShape = {
  id: string;
  batchId: string;
  batchName: string;
  coachId: string;
  coachName: string;
  venueId: string;
  startsAt: string;
  endsAt: string;
  status: "scheduled" | "completed" | "cancelled";
  attendanceSummary: { present: number; absent: number; excused: number; total: number } | null;
  coachNote: string | null;
  kind: "group_class" | "one_on_one";
  capacity: number | null;
  bookedCount: number;
  waitlistCount: number;
  myBookingStatus: "booked" | "waitlisted" | "cancelled" | null;
};

/** Sessions the member belongs to (enrolled batch) or holds a live booking for, in [from, to]. */
async function loadMemberSessions(db: TenantClient, p: Principal, memberId: string, from: string, to: string) {
  const [enrollments, myBookings] = await Promise.all([
    db.batchMember.findMany({ where: { memberId }, select: { batchId: true, joinedOn: true, leftOn: true } }),
    db.sessionBooking.findMany({ where: { memberId }, select: { sessionId: true, status: true } }),
  ]);
  const liveBooked = new Set(myBookings.filter((b) => b.status !== "CANCELLED").map((b) => b.sessionId));
  const rows = await db.session.findMany({
    where: {
      startsAt: { gte: startOfDay(from), lt: startOfDay(addDays(to, 1)) },
      OR: [{ batchId: { in: enrollments.map((e) => e.batchId) } }, { id: { in: [...liveBooked] } }],
    },
    include: {
      batch: { select: { name: true, venueId: true, kind: true, capacity: true } },
      coach: { select: { name: true } },
    },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
  });
  const mine = rows.filter((s) => {
    if (liveBooked.has(s.id)) return true;
    const day = dateOnly(s.startsAt);
    return enrollments.some((e) => e.batchId === s.batchId && e.joinedOn <= day && (e.leftOn === null || e.leftOn >= day));
  });
  const ids = mine.map((s) => s.id);
  const [attGroups, bookGroups] = ids.length
    ? await Promise.all([
        p.role === "customer"
          ? Promise.resolve([])
          : db.attendance.groupBy({ by: ["sessionId", "status"], where: { sessionId: { in: ids } }, _count: { _all: true } }),
        db.sessionBooking.groupBy({
          by: ["sessionId", "status"],
          where: { sessionId: { in: ids }, status: { in: ["BOOKED", "WAITLISTED"] } },
          _count: { _all: true },
        }),
      ])
    : [[], []];
  const summary = new Map<string, { present: number; absent: number; excused: number; total: number }>();
  for (const g of attGroups) {
    const s = summary.get(g.sessionId) ?? { present: 0, absent: 0, excused: 0, total: 0 };
    if (g.status === "PRESENT") s.present += g._count._all;
    else if (g.status === "ABSENT") s.absent += g._count._all;
    else s.excused += g._count._all;
    s.total += g._count._all;
    summary.set(g.sessionId, s);
  }
  const booked = new Map<string, number>();
  const waiting = new Map<string, number>();
  for (const g of bookGroups) (g.status === "BOOKED" ? booked : waiting).set(g.sessionId, g._count._all);
  const rank = { booked: 0, waitlisted: 1, cancelled: 2 } as const;
  const myStatus = new Map<string, keyof typeof rank>();
  for (const b of myBookings) {
    const st = b.status.toLowerCase() as keyof typeof rank;
    const cur = myStatus.get(b.sessionId);
    if (!cur || rank[st] < rank[cur]) myStatus.set(b.sessionId, st);
  }
  return mine.map(
    (s): SessionDtoShape => ({
      id: s.id,
      batchId: s.batchId,
      batchName: s.batch.name,
      coachId: s.coachId,
      coachName: s.coach.name,
      venueId: s.batch.venueId,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      status: s.status.toLowerCase() as SessionDtoShape["status"],
      attendanceSummary: summary.get(s.id) ?? null,
      coachNote: s.coachNote,
      kind: s.batch.kind === "ONE_ON_ONE" ? "one_on_one" : "group_class",
      capacity: s.capacity ?? s.batch.capacity,
      bookedCount: booked.get(s.id) ?? 0,
      waitlistCount: waiting.get(s.id) ?? 0,
      myBookingStatus: myStatus.get(s.id) ?? null,
    }),
  );
}

/**
 * GET /members/{memberId}/schedule (getMemberSchedule). One entry per calendar day in the range:
 * dated workout items with their log status, the member's sessions (enrolled batch or live
 * booking) and the holiday flag. Same visibility as getMember.
 */
export async function getMemberSchedule(db: TenantClient, p: Principal, memberId: string, params: URLSearchParams, now = new Date()) {
  await assertCanViewMember(db, p, memberId);
  const today = tenantDate(now);
  const { from, to } = parseRange(params, today, { from: 0, to: 6 }, SCHEDULE_MAX_DAYS);

  const [entries, sessions, holidays, unread] = await Promise.all([
    loadScheduledEntries(db, [memberId], from, to),
    loadMemberSessions(db, p, memberId, from, to),
    db.holiday.findMany({ where: { date: { gte: dateToDb(from), lte: dateToDb(to) } }, select: { date: true, name: true } }),
    db.memberUpdate.count({ where: { memberId, readAt: null } }),
  ]);
  const holidayBy = new Map(holidays.map((h) => [dateFromDb(h.date), h.name]));

  const days = eachDate(from, to).map((date) => {
    const todays = entries.filter((e) => e.date === date);
    const dayTitle = todays.find((e) => e.dayTitle)?.dayTitle ?? null;
    return {
      date,
      isHoliday: holidayBy.has(date),
      holidayName: holidayBy.get(date) ?? null,
      dayTitle,
      items: todays
        .sort((a, b) => a.planTitle.localeCompare(b.planTitle) || a.item.position - b.item.position)
        .map((e) => ({
          assignmentId: e.assignmentId,
          planId: e.planId,
          planTitle: e.planTitle,
          planItemId: e.item.id,
          exerciseId: e.item.exerciseId,
          exerciseName: e.item.exerciseName,
          position: e.item.position,
          sets: e.item.sets,
          reps: e.item.reps,
          durationSeconds: e.item.durationSeconds,
          restSeconds: e.item.restSeconds,
          notes: e.item.notes,
          status: e.log?.status ?? ("pending" as ItemStatus),
          logId: e.log?.id ?? null,
        })),
      sessions: sessions.filter((s) => tenantDate(new Date(s.startsAt)) === date),
    };
  });
  return { memberId, from, to, unreadUpdates: unread, days };
}
