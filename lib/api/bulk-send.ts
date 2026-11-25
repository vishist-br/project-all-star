import type { Prisma } from "@prisma/client";
import { assertCanEditPlan, managedMemberWhere, planWhere } from "../auth/access";
import { ApiError } from "../auth/errors";
import type { Principal } from "../auth/principal";
import type { TenantClient } from "../tenant-scope";
import { findNewBests, type HistorySession, type SetLike } from "../workouts/records";
import { Problems, dateFromDb, dateToDb, isDateString, isRecord, textField } from "../workouts/validate";
import { recordMemberUpdates } from "./member-updates";
import { tenantDate } from "./pagination";
import { addDays, parseRange } from "./schedule";
import { setDto } from "./workout-sets";

const MAX_MEMBERS = 100;
const REPEAT_MODES = ["ongoing", "once", "weeks", "until"] as const;
type Repeat = { mode: (typeof REPEAT_MODES)[number]; weeks?: number; endsOn?: string };

function parseRepeat(v: Problems, raw: unknown, startsOn: string | null): string | null {
  if (raw === undefined || raw === null) return null;
  if (!isRecord(raw) || !(REPEAT_MODES as readonly unknown[]).includes(raw.mode)) {
    v.add("repeat.mode", `One of ${REPEAT_MODES.join(", ")}`);
    return null;
  }
  const r = raw as unknown as Repeat;
  if (r.mode === "ongoing") return null;
  if (!startsOn) return null;
  if (r.mode === "once") return startsOn;
  if (r.mode === "weeks") {
    if (typeof r.weeks !== "number" || !Number.isInteger(r.weeks) || r.weeks < 1 || r.weeks > 52) {
      v.add("repeat.weeks", "Integer 1..52");
      return null;
    }
    return addDays(startsOn, r.weeks * 7 - 1);
  }
  if (!isDateString(r.endsOn)) {
    v.add("repeat.endsOn", "Date YYYY-MM-DD");
    return null;
  }
  if (r.endsOn < startsOn) {
    v.add("repeat.endsOn", "Must not be before startsOn");
    return null;
  }
  return r.endsOn;
}

/**
 * POST /plan-assignments/bulk (sendPlanToMembers). Gives one plan to many members in one transaction
 * and writes one `plan_assigned` update each. Idempotent on (plan, member, startsOn): sending again
 * answers `already_sent` with the existing assignment. A member who still has the plan active from a
 * different start date is `skipped_active`. Unknown or foreign plan or members fail the whole request.
 */
export async function sendPlanToMembers(db: TenantClient, p: Principal, body: unknown) {
  if (!isRecord(body)) throw new ApiError("validation_failed", "Body must be a JSON object");
  const v = new Problems();
  const planId = typeof body.planId === "string" && body.planId ? body.planId : null;
  if (!planId) v.add("planId", "Required");
  let memberIds: string[] = [];
  if (!Array.isArray(body.memberIds) || body.memberIds.length < 1 || body.memberIds.length > MAX_MEMBERS) v.add("memberIds", `1..${MAX_MEMBERS} member ids`);
  else if (!body.memberIds.every((m) => typeof m === "string" && m.length > 0)) v.add("memberIds", "Strings expected");
  else memberIds = [...new Set(body.memberIds as string[])];
  const startsOn = isDateString(body.startsOn) ? body.startsOn : (v.add("startsOn", "Date YYYY-MM-DD"), null);
  const endsOn = parseRepeat(v, body.repeat, startsOn);
  const note = textField(v, body, "note", "", 280);
  v.throwIfAny();

  const plan = await db.workoutPlan.findFirst({ where: { id: planId! }, select: { id: true, title: true, status: true, version: true } });
  if (!plan) throw new ApiError("not_found", "Plan not found");
  if (!(await db.workoutPlan.findFirst({ where: { id: plan.id, ...planWhere(p) }, select: { id: true } }))) throw new ApiError("forbidden", "This plan is not yours");
  if (plan.status !== "ACTIVE") throw new ApiError("conflict", "Only an active plan can be sent");

  const members = await db.member.findMany({ where: { id: { in: memberIds } }, select: { id: true, displayName: true, isActive: true } });
  if (members.length !== memberIds.length) throw new ApiError("not_found", "Member not found");
  const allowed = new Set((await db.member.findMany({ where: { id: { in: memberIds }, ...managedMemberWhere(p) }, select: { id: true } })).map((m) => m.id));
  if (memberIds.some((m) => !allowed.has(m))) throw new ApiError("forbidden", "One or more members are not yours");
  if (members.some((m) => !m.isActive)) throw new ApiError("validation_failed", "Member is no longer active", [{ field: "memberIds", message: "Inactive member" }]);

  const start = startsOn as string;
  const results = await db.$transaction(async (raw) => {
    const tx = raw as unknown as TenantClient;
    const existing = await tx.planAssignment.findMany({
      where: { planId: plan.id, memberId: { in: memberIds }, OR: [{ startsOn: dateToDb(start) }, { status: { not: "ENDED" } }] },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, memberId: true, startsOn: true, status: true },
    });
    const out: { memberId: string; memberName: string; status: "sent" | "already_sent" | "skipped_active"; assignmentId: string }[] = [];
    for (const m of members.sort((a, b) => memberIds.indexOf(a.id) - memberIds.indexOf(b.id))) {
      const mine = existing.filter((e) => e.memberId === m.id);
      const same = mine.find((e) => dateFromDb(e.startsOn) === start);
      if (same) {
        out.push({ memberId: m.id, memberName: m.displayName, status: "already_sent", assignmentId: same.id });
        continue;
      }
      const active = mine.find((e) => e.status !== "ENDED");
      if (active) {
        out.push({ memberId: m.id, memberName: m.displayName, status: "skipped_active", assignmentId: active.id });
        continue;
      }
      const a = await tx.planAssignment.create({
        data: { planId: plan.id, memberId: m.id, assignedById: p.userId, startsOn: dateToDb(start), endsOn: endsOn ? dateToDb(endsOn) : null, planVersion: plan.version, note } as never,
        select: { id: true },
      });
      await recordMemberUpdates(tx, {
        memberIds: [m.id],
        kind: "PLAN_ASSIGNED",
        entityType: "assignment",
        entityId: a.id,
        actorId: p.userId,
        params: { planTitle: plan.title, startsOn: start, ...(note ? { note } : {}) },
      });
      out.push({ memberId: m.id, memberName: m.displayName, status: "sent", assignmentId: a.id });
    }
    return out;
  });
  return {
    planId: plan.id,
    planTitle: plan.title,
    startsOn: start,
    endsOn,
    results,
    sentCount: results.filter((r) => r.status === "sent").length,
    alreadySentCount: results.filter((r) => r.status === "already_sent").length,
    skippedCount: results.filter((r) => r.status === "skipped_active").length,
  };
}

const MAX_RESULT_DAYS = 92;

/**
 * GET /workout-plans/{planId}/results (getPlanResults). Per assignment of the plan (optionally one
 * member): what was logged per item and set in the date range (default the last 28 days), the member's
 * note and the new bests. Owner, or the coach who owns the plan.
 */
export async function getPlanResults(db: TenantClient, p: Principal, planId: string, params: URLSearchParams, now = new Date()) {
  await assertCanEditPlan(db, p, planId);
  const today = tenantDate(now);
  const { from, to } = parseRange(params, today, { from: -27, to: 0 }, MAX_RESULT_DAYS);
  const memberId = params.get("memberId") || null;

  const assignments = await db.planAssignment.findMany({
    where: { planId, ...(memberId ? { memberId } : {}) },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: { member: { select: { displayName: true } } },
    take: 200,
  });
  if (memberId && assignments.length === 0 && !(await db.member.findFirst({ where: { id: memberId }, select: { id: true } }))) {
    throw new ApiError("not_found", "Member not found");
  }
  const ids = assignments.map((a) => a.id);
  const logs = ids.length
    ? await db.workoutLog.findMany({
        where: { assignmentId: { in: ids }, scheduledFor: { gte: dateToDb(from), lte: dateToDb(to) } },
        orderBy: [{ scheduledFor: "desc" }, { createdAt: "asc" }, { id: "asc" }],
        include: {
          planItem: { select: { exerciseId: true, position: true, exercise: { select: { name: true, metricType: true } } } },
          sets: { orderBy: [{ setNumber: "asc" }, { completedAt: "asc" }, { id: "asc" }] },
        },
      })
    : [];

  // History of the (member, exercise) pairs seen in range, to tell which sets broke a record.
  const members = [...new Set(logs.map((l) => l.memberId))];
  const exercises = [...new Set(logs.map((l) => l.planItem.exerciseId))];
  const hist = logs.some((l) => l.sets.length > 0)
    ? await db.workoutSet.findMany({
        where: { log: { memberId: { in: members }, planItem: { exerciseId: { in: exercises } } } },
        include: { log: { select: { memberId: true, scheduledFor: true, planItem: { select: { exerciseId: true } } } } },
      } satisfies Prisma.WorkoutSetFindManyArgs)
    : [];
  const sessionsBy = new Map<string, Map<string, HistorySession>>();
  for (const s of hist) {
    const key = `${s.log.memberId}|${s.log.planItem.exerciseId}`;
    const sessions = sessionsBy.get(key) ?? new Map<string, HistorySession>();
    const cur = sessions.get(s.logId) ?? { logId: s.logId, date: dateFromDb(s.log.scheduledFor), sets: [] as SetLike[] };
    cur.sets.push({ setType: s.setType, weightKg: s.weightKg === null ? null : Number(s.weightKg.toString()), reps: s.reps, seconds: s.seconds, meters: s.meters, scoreMade: s.scoreMade, scoreOf: s.scoreOf });
    sessions.set(s.logId, cur);
    sessionsBy.set(key, sessions);
  }
  const rangeLogIds = new Set(logs.map((l) => l.id));
  const bestByLog = new Map<string, ReturnType<typeof findNewBests>>();
  for (const sessions of sessionsBy.values()) {
    for (const nb of findNewBests([...sessions.values()], rangeLogIds)) bestByLog.set(nb.logId, [...(bestByLog.get(nb.logId) ?? []), nb]);
  }

  const items = assignments.map((a) => {
    const mine = logs.filter((l) => l.assignmentId === a.id);
    const dates = [...new Set(mine.map((l) => dateFromDb(l.scheduledFor)))].sort().reverse();
    const days = dates.map((date) => ({
      date,
      items: mine
        .filter((l) => dateFromDb(l.scheduledFor) === date)
        .sort((x, y) => x.planItem.position - y.planItem.position)
        .map((l) => ({
          logId: l.id,
          planItemId: l.planItemId,
          exerciseId: l.planItem.exerciseId,
          exerciseName: l.planItem.exercise.name,
          metricType: l.planItem.exercise.metricType,
          status: l.status.toLowerCase(),
          note: l.note,
          actualSets: l.actualSets,
          actualReps: l.actualReps,
          actualDurationSeconds: l.actualDurationSeconds,
          sets: l.sets.map(setDto),
          newBests: (bestByLog.get(l.id) ?? []).map(({ metric, value, previous }) => ({ metric, value, previous })),
        })),
    }));
    return {
      assignmentId: a.id,
      memberId: a.memberId,
      memberName: a.member.displayName,
      status: a.status.toLowerCase(),
      startsOn: dateFromDb(a.startsOn),
      endsOn: a.endsOn ? dateFromDb(a.endsOn) : null,
      note: a.note,
      itemsCompleted: mine.filter((l) => l.status === "COMPLETED").length,
      itemsSkipped: mine.filter((l) => l.status === "SKIPPED").length,
      daysLogged: dates.length,
      setCount: mine.reduce((n, l) => n + l.sets.length, 0),
      newBestCount: mine.reduce((n, l) => n + (bestByLog.get(l.id)?.length ?? 0), 0),
      days,
    };
  });
  return { planId, from, to, items };
}
