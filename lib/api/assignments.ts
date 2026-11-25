import { Prisma, type AssignmentStatus } from "@prisma/client";
import { assertCanManageMember, assignmentWhere, managedMemberWhere, planWhere } from "../auth/access";
import { ApiError } from "../auth/errors";
import type { Principal } from "../auth/principal";
import type { TenantClient } from "../tenant-scope";
import { expandSchedule, logKey, type Cadence } from "../workouts/expand";
import { Problems, dateFromDb, dateToDb, isDateString, isRecord, textField } from "../workouts/validate";
import { recordMemberUpdates } from "./member-updates";
import { enumParam, pageArgs, tenantDate, toPage } from "./pagination";

const STATUSES = ["active", "paused", "ended"] as const;
const ADHERENCE_WINDOW_DAYS = 365;

const include = {
  plan: { select: { title: true, cadence: true, version: true } },
  member: { select: { displayName: true } },
  assignedBy: { select: { name: true } },
} satisfies Prisma.PlanAssignmentInclude;
type Row = Prisma.PlanAssignmentGetPayload<{ include: typeof include }>;

const pct = (a: number, b: number) => (b === 0 ? null : Math.min(100, Math.round((1000 * a) / b) / 10));

function addDays(date: string, n: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Share of scheduled workout items completed, from the start of the assignment (at most the last
 * year) up to today or its end date. Null for paused assignments and when nothing was scheduled yet.
 */
async function adherenceFor(db: TenantClient, rows: Row[]): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  const today = tenantDate(new Date());
  const counted = rows.filter((r) => r.status !== "PAUSED");
  for (const r of rows) out.set(r.id, null);
  if (counted.length === 0) return out;

  const days = await db.workoutPlanDay.findMany({
    where: { planId: { in: [...new Set(counted.map((r) => r.planId))] } },
    include: { items: { select: { id: true, archivedAt: true } } },
  });
  const daysByPlan = new Map<string, typeof days>();
  for (const d of days) daysByPlan.set(d.planId, [...(daysByPlan.get(d.planId) ?? []), d]);

  const logs = await db.workoutLog.findMany({
    where: { assignmentId: { in: counted.map((r) => r.id) } },
    select: { assignmentId: true, planItemId: true, scheduledFor: true, status: true },
  });
  const logsBy = new Map<string, typeof logs>();
  for (const l of logs) logsBy.set(l.assignmentId, [...(logsBy.get(l.assignmentId) ?? []), l]);

  for (const r of counted) {
    const startsOn = dateFromDb(r.startsOn);
    const endsOn = r.endsOn ? dateFromDb(r.endsOn) : null;
    const to = endsOn && endsOn < today ? endsOn : today;
    const earliest = addDays(today, -ADHERENCE_WINDOW_DAYS);
    const from = startsOn > earliest ? startsOn : earliest;
    if (from > to) continue;
    const mine = logsBy.get(r.id) ?? [];
    const logged = new Set(mine.map((l) => logKey(l.planItemId, dateFromDb(l.scheduledFor))));
    const scheduled = expandSchedule(
      { status: "active", startsOn, endsOn },
      {
        cadence: r.plan.cadence.toLowerCase() as Cadence,
        days: (daysByPlan.get(r.planId) ?? []).map((d) => ({ dayIndex: d.dayIndex, items: d.items })),
      },
      from,
      to,
      logged,
    ).reduce((n, d) => n + d.items.length, 0);
    const completed = mine.filter((l) => {
      const d = dateFromDb(l.scheduledFor);
      return l.status === "COMPLETED" && d >= from && d <= to;
    }).length;
    out.set(r.id, pct(completed, scheduled));
  }
  return out;
}

async function toDtos(db: TenantClient, rows: Row[]) {
  const adherence = await adherenceFor(db, rows);
  return rows.map((r) => ({
    id: r.id,
    planId: r.planId,
    planTitle: r.plan.title,
    planVersion: r.planVersion,
    cadence: r.plan.cadence.toLowerCase(),
    memberId: r.memberId,
    memberName: r.member.displayName,
    assignedById: r.assignedById,
    assignedByName: r.assignedBy.name,
    status: r.status.toLowerCase(),
    startsOn: dateFromDb(r.startsOn),
    endsOn: r.endsOn ? dateFromDb(r.endsOn) : null,
    note: r.note,
    adherencePercent: adherence.get(r.id) ?? null,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

/** GET /plan-assignments (listPlanAssignments). */
export async function listPlanAssignments(db: TenantClient, p: Principal, params: URLSearchParams) {
  const { limit, args } = pageArgs(params);
  const and: Prisma.PlanAssignmentWhereInput[] = [assignmentWhere(p)];
  const memberId = params.get("memberId");
  if (memberId) and.push({ memberId });
  const planId = params.get("planId");
  if (planId) and.push({ planId });
  const status = enumParam(params, "status", STATUSES);
  if (status) and.push({ status: status.toUpperCase() as AssignmentStatus });
  const rows = await db.planAssignment.findMany({
    where: { AND: and },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    include,
    ...args,
  });
  const page = toPage(rows, limit);
  return { items: await toDtos(db, page.rows), nextCursor: page.nextCursor };
}

/**
 * Lean listPlanAssignments for cards that only need the plan, dates, status and note (STAR-102): one
 * query, no adherence maths (which reads every plan day and log). Same visibility and order.
 */
export async function listAssignmentBriefs(db: TenantClient, p: Principal, memberId: string, limit = 50) {
  const rows = await db.planAssignment.findMany({
    where: { AND: [assignmentWhere(p), { memberId }] },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: Math.min(Math.max(limit, 1), 100),
    select: { id: true, planId: true, status: true, startsOn: true, endsOn: true, note: true, plan: { select: { title: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    planId: r.planId,
    planTitle: r.plan.title,
    status: r.status.toLowerCase(),
    startsOn: dateFromDb(r.startsOn),
    endsOn: r.endsOn ? dateFromDb(r.endsOn) : null,
    note: r.note,
  }));
}

/** POST /plan-assignments (createPlanAssignments). All or nothing; 409 for a duplicate active assignment. */
export async function createPlanAssignments(db: TenantClient, p: Principal, body: unknown) {
  if (!isRecord(body)) throw new ApiError("validation_failed", "Body must be a JSON object");
  const v = new Problems();
  const planId = typeof body.planId === "string" && body.planId ? body.planId : null;
  if (!planId) v.add("planId", "Required");
  let memberIds: string[] = [];
  if (!Array.isArray(body.memberIds) || body.memberIds.length < 1 || body.memberIds.length > 50) {
    v.add("memberIds", "1..50 member ids");
  } else if (!body.memberIds.every((m) => typeof m === "string" && m.length > 0)) {
    v.add("memberIds", "Strings expected");
  } else memberIds = [...new Set(body.memberIds as string[])];
  const startsOn = body.startsOn;
  if (!isDateString(startsOn)) v.add("startsOn", "Date YYYY-MM-DD");
  let endsOn: string | null = null;
  if (body.endsOn !== undefined && body.endsOn !== null) {
    if (isDateString(body.endsOn)) endsOn = body.endsOn;
    else v.add("endsOn", "Date YYYY-MM-DD or null");
  }
  if (endsOn && isDateString(startsOn) && endsOn < startsOn) v.add("endsOn", "Must not be before startsOn");
  const note = textField(v, body, "note", "", 280);
  v.throwIfAny();

  const plan = await db.workoutPlan.findFirst({ where: { id: planId! }, select: { id: true, title: true, status: true, version: true } });
  if (!plan) throw new ApiError("not_found", "Plan not found");
  const mine = await db.workoutPlan.findFirst({ where: { id: plan.id, ...planWhere(p) }, select: { id: true } });
  if (!mine) throw new ApiError("forbidden", "This plan is not yours");
  if (plan.status !== "ACTIVE") throw new ApiError("conflict", "Only an active plan can be assigned");

  const inTenant = await db.member.findMany({ where: { id: { in: memberIds } }, select: { id: true, isActive: true } });
  if (inTenant.length !== memberIds.length) throw new ApiError("not_found", "Member not found");
  const allowed = new Set((await db.member.findMany({ where: { id: { in: memberIds }, ...managedMemberWhere(p) }, select: { id: true } })).map((m) => m.id));
  if (memberIds.some((m) => !allowed.has(m))) throw new ApiError("forbidden", "One or more members are not yours");
  const inactive = inTenant.find((m) => !m.isActive);
  if (inactive) throw new ApiError("validation_failed", "Member is no longer active", [{ field: "memberIds", message: "Inactive member" }]);

  const clash = await db.planAssignment.findFirst({
    where: { planId: plan.id, memberId: { in: memberIds }, status: { not: "ENDED" } },
    select: { id: true },
  });
  if (clash) throw new ApiError("conflict", "This plan is already assigned to one of the members");

  let ids: string[];
  try {
    ids = await db.$transaction(async (raw) => {
      const tx = raw as unknown as TenantClient;
      const made: string[] = [];
      for (const memberId of memberIds) {
        const a = await tx.planAssignment.create({
          data: {
            planId: plan.id,
            memberId,
            assignedById: p.userId,
            startsOn: dateToDb(startsOn as string),
            endsOn: endsOn ? dateToDb(endsOn) : null,
            planVersion: plan.version,
            note,
          } as never,
          select: { id: true },
        });
        made.push(a.id);
        await recordMemberUpdates(tx, {
          memberIds: [memberId],
          kind: "PLAN_ASSIGNED",
          entityType: "assignment",
          entityId: a.id,
          actorId: p.userId,
          params: { planTitle: plan.title, startsOn: startsOn as string, ...(note ? { note } : {}) },
        });
      }
      return made;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new ApiError("conflict", "This plan is already assigned to one of the members");
    }
    throw err;
  }
  const rows = await db.planAssignment.findMany({ where: { id: { in: ids } }, include, orderBy: { id: "asc" } });
  const order = new Map(ids.map((id, i) => [id, i]));
  rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  return { items: await toDtos(db, rows) };
}

/** PATCH /plan-assignments/{id} (updatePlanAssignment): pause, resume, end, change dates or note. */
export async function updatePlanAssignment(db: TenantClient, p: Principal, assignmentId: string, body: unknown) {
  if (!isRecord(body)) throw new ApiError("validation_failed", "Body must be a JSON object");
  const v = new Problems();
  let status: AssignmentStatus | undefined;
  if (body.status !== undefined) {
    if ((STATUSES as readonly unknown[]).includes(body.status)) status = (body.status as string).toUpperCase() as AssignmentStatus;
    else v.add("status", `One of ${STATUSES.join(", ")}`);
  }
  let startsOn: string | undefined;
  if (body.startsOn !== undefined) {
    if (isDateString(body.startsOn)) startsOn = body.startsOn;
    else v.add("startsOn", "Date YYYY-MM-DD");
  }
  let endsOn: string | null | undefined;
  if (body.endsOn !== undefined) {
    if (body.endsOn === null) endsOn = null;
    else if (isDateString(body.endsOn)) endsOn = body.endsOn;
    else v.add("endsOn", "Date YYYY-MM-DD or null");
  }
  let note: string | null | undefined;
  if (body.note !== undefined) note = textField(v, body, "note", "", 280);
  if (status === undefined && startsOn === undefined && endsOn === undefined && note === undefined && v.list.length === 0) {
    v.add("body", "Send at least one of status, startsOn, endsOn, note");
  }
  v.throwIfAny();

  const row = await db.planAssignment.findFirst({ where: { id: assignmentId }, include });
  if (!row) throw new ApiError("not_found", "Assignment not found");
  await assertCanManageMember(db, p, row.memberId);
  if (row.status === "ENDED") throw new ApiError("conflict", "An ended assignment cannot be changed");

  const today = tenantDate(new Date());
  const nextStart = startsOn ?? dateFromDb(row.startsOn);
  let nextEnd: string | null = endsOn !== undefined ? endsOn : row.endsOn ? dateFromDb(row.endsOn) : null;
  const nextStatus = status ?? row.status;
  if (nextStatus === "ENDED" && endsOn === undefined && (nextEnd === null || nextEnd > today)) {
    nextEnd = today >= nextStart ? today : nextStart;
  }
  if (nextEnd && nextEnd < nextStart) {
    throw new ApiError("validation_failed", "endsOn must not be before startsOn", [{ field: "endsOn", message: "Must not be before startsOn" }]);
  }

  const plan = await db.workoutPlan.findFirst({ where: { id: row.planId }, select: { version: true } });
  await db.$transaction(async (raw) => {
    const tx = raw as unknown as TenantClient;
    const done = await tx.planAssignment.updateMany({
      where: { id: assignmentId, status: { not: "ENDED" } },
      data: {
        status: nextStatus,
        startsOn: dateToDb(nextStart),
        endsOn: nextEnd ? dateToDb(nextEnd) : null,
        ...(note !== undefined ? { note } : {}),
        planVersion: plan?.version ?? row.planVersion,
      },
    });
    if (done.count === 0) throw new ApiError("conflict", "An ended assignment cannot be changed");
    await recordMemberUpdates(tx, {
      memberIds: [row.memberId],
      kind: nextStatus === "ENDED" ? "PLAN_ENDED" : "PLAN_UPDATED",
      entityType: "assignment",
      entityId: assignmentId,
      actorId: p.userId,
      params: {
        planTitle: row.plan.title,
        status: nextStatus.toLowerCase(),
        ...(note ? { note } : {}),
      },
    });
  });
  const fresh = await db.planAssignment.findFirst({ where: { id: assignmentId }, include });
  return (await toDtos(db, [fresh!]))[0];
}
