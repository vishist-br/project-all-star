import { Prisma, type WorkoutLogStatus } from "@prisma/client";
import { assertCanManageMember, assertCanViewMember, memberWhere } from "../auth/access";
import { ApiError } from "../auth/errors";
import type { Principal } from "../auth/principal";
import type { TenantClient } from "../tenant-scope";
import { Problems, dateFromDb, dateToDb, isDateString, isRecord } from "../workouts/validate";
import { dateParam, pageArgs, tenantDate, toPage } from "./pagination";
import { loadScheduledEntries } from "./schedule";

const ACTIONS = ["start", "stop", "complete", "skip"] as const;
type Action = (typeof ACTIONS)[number];
/** Device clocks may run ahead; an occurredAt further in the future is clamped to now. */
const CLOCK_SKEW_MS = 5 * 60_000;

const include = {
  assignment: { select: { planId: true, plan: { select: { title: true } } } },
  planItem: { select: { exerciseId: true, exercise: { select: { name: true } } } },
} satisfies Prisma.WorkoutLogInclude;
type Row = Prisma.WorkoutLogGetPayload<{ include: typeof include }>;

function toDto(r: Row) {
  return {
    id: r.id,
    clientId: r.clientId,
    assignmentId: r.assignmentId,
    planId: r.assignment.planId,
    planTitle: r.assignment.plan.title,
    planItemId: r.planItemId,
    exerciseId: r.planItem.exerciseId,
    exerciseName: r.planItem.exercise.name,
    memberId: r.memberId,
    scheduledFor: dateFromDb(r.scheduledFor),
    status: r.status.toLowerCase(),
    startedAt: r.startedAt?.toISOString() ?? null,
    completedAt: r.completedAt?.toISOString() ?? null,
    actualSets: r.actualSets,
    actualReps: r.actualReps,
    actualDurationSeconds: r.actualDurationSeconds,
    note: r.note,
    recordedById: r.recordedById,
  };
}

/** GET /members/{memberId}/workout-logs (listWorkoutLogs). Newest scheduled date first. */
export async function listWorkoutLogs(db: TenantClient, p: Principal, memberId: string, params: URLSearchParams) {
  await assertCanViewMember(db, p, memberId);
  const { limit, args } = pageArgs(params);
  const from = dateParam(params, "from");
  const to = dateParam(params, "to");
  const fromD = params.get("from");
  const toD = params.get("to");
  if (from && to && toD! < fromD!) {
    throw new ApiError("validation_failed", "to must not be before from", [{ field: "to", message: "Must not be before from" }]);
  }
  const rows = await db.workoutLog.findMany({
    where: {
      memberId,
      ...(from || to ? { scheduledFor: { ...(fromD ? { gte: dateToDb(fromD) } : {}), ...(toD ? { lte: dateToDb(toD) } : {}) } } : {}),
    },
    orderBy: [{ scheduledFor: "desc" }, { createdAt: "desc" }, { id: "asc" }],
    include,
    ...args,
  });
  const page = toPage(rows, limit);
  return { items: page.rows.map(toDto), nextCursor: page.nextCursor };
}

type Input = {
  clientId: string;
  assignmentId: string;
  planItemId: string;
  memberId: string | null;
  scheduledFor: string;
  action: Action;
  actualSets: number | null | undefined;
  actualReps: number | null | undefined;
  actualDurationSeconds: number | null | undefined;
  note: string | null | undefined;
  occurredAt: Date | null;
};

function parseInput(body: unknown): Input {
  if (!isRecord(body)) throw new ApiError("validation_failed", "Body must be a JSON object");
  const v = new Problems();
  const str = (k: string, min: number, max: number) => {
    const x = body[k];
    if (typeof x !== "string" || x.length < min || x.length > max) {
      v.add(k, min > 1 ? `String of ${min}..${max} characters` : "Required string");
      return "";
    }
    return x;
  };
  const clientId = str("clientId", 8, 64);
  const assignmentId = str("assignmentId", 1, 100);
  const planItemId = str("planItemId", 1, 100);
  let memberId: string | null = null;
  if (body.memberId !== undefined && body.memberId !== null) {
    if (typeof body.memberId !== "string" || !body.memberId) v.add("memberId", "String");
    else memberId = body.memberId;
  }
  const scheduledFor = isDateString(body.scheduledFor) ? body.scheduledFor : (v.add("scheduledFor", "Date YYYY-MM-DD"), "");
  const action = ACTIONS.find((a) => a === body.action);
  if (!action) v.add("action", `One of ${ACTIONS.join(", ")}`);
  const num = (k: string, max: number): number | null | undefined => {
    const x = body[k];
    if (x === undefined) return undefined;
    if (x === null) return null;
    if (typeof x !== "number" || !Number.isInteger(x) || x < 0 || x > max) {
      v.add(k, `Integer 0..${max}`);
      return undefined;
    }
    return x;
  };
  const actualSets = num("actualSets", 50);
  const actualReps = num("actualReps", 500);
  const actualDurationSeconds = num("actualDurationSeconds", 14_400);
  let note: string | null | undefined;
  if (body.note === null) note = null;
  else if (body.note !== undefined) {
    if (typeof body.note !== "string" || body.note.length > 280) v.add("note", "Text up to 280 characters");
    else note = body.note;
  }
  let occurredAt: Date | null = null;
  if (body.occurredAt !== undefined && body.occurredAt !== null) {
    const d = typeof body.occurredAt === "string" && /^\d{4}-\d{2}-\d{2}T/.test(body.occurredAt) ? new Date(body.occurredAt) : null;
    if (!d || Number.isNaN(d.getTime())) v.add("occurredAt", "ISO date-time");
    else occurredAt = d;
  }
  v.throwIfAny();
  return { clientId, assignmentId, planItemId, memberId, scheduledFor, action: action!, actualSets, actualReps, actualDurationSeconds, note, occurredAt };
}

/** The state machine of the contract. Returns the next status, "same" for an idempotent repeat, or null for a conflict. */
export function nextStatus(current: WorkoutLogStatus | null, action: Action): WorkoutLogStatus | "same" | null {
  const target: Record<Action, WorkoutLogStatus> = { start: "STARTED", stop: "STOPPED", complete: "COMPLETED", skip: "SKIPPED" };
  const to = target[action];
  if (current === null) return action === "stop" ? null : to;
  if (current === to) return "same";
  const allowed: Record<WorkoutLogStatus, WorkoutLogStatus[]> = {
    STARTED: ["STOPPED", "COMPLETED"],
    STOPPED: ["STARTED", "COMPLETED"],
    COMPLETED: [],
    SKIPPED: [],
  };
  return allowed[current].includes(to) ? to : null;
}

/**
 * PUT /workout-logs (recordWorkoutLog). Upsert by (assignment, item, scheduledFor); `clientId` makes
 * offline retries safe. Repeating the action a log is already in answers 200 without changes, so a
 * replayed queue converges. A clientId already stored on a different log answers 409.
 */
export async function recordWorkoutLog(db: TenantClient, p: Principal, body: unknown, now = new Date()) {
  const input = parseInput(body);

  const assignment = await db.planAssignment.findFirst({ where: { id: input.assignmentId }, select: { id: true, memberId: true } });
  if (!assignment) throw new ApiError("not_found", "Assignment not found");
  if (p.role === "customer") {
    const ok = await db.member.findFirst({ where: { id: assignment.memberId, ...memberWhere(p) }, select: { id: true } });
    if (!ok) throw new ApiError("forbidden", "This assignment is outside your own view");
  } else {
    await assertCanManageMember(db, p, assignment.memberId);
  }
  if (input.memberId && input.memberId !== assignment.memberId) {
    throw new ApiError("validation_failed", "memberId does not match the assignment", [{ field: "memberId", message: "Must match the assignment's member" }]);
  }
  if (input.scheduledFor > tenantDate(now)) {
    throw new ApiError("validation_failed", "scheduledFor cannot be in the future", [{ field: "scheduledFor", message: "Not in the future" }]);
  }
  const date = input.scheduledFor;
  const scheduled = await loadScheduledEntries(db, [assignment.memberId], date, date);
  if (!scheduled.some((e) => e.assignmentId === assignment.id && e.item.id === input.planItemId)) {
    throw new ApiError("validation_failed", "This item is not scheduled for the member on that date", [
      { field: "planItemId", message: "Not scheduled on scheduledFor" },
    ]);
  }
  const occurred = input.occurredAt ? new Date(Math.min(input.occurredAt.getTime(), now.getTime() + CLOCK_SKEW_MS)) : now;

  const key = { assignmentId: assignment.id, planItemId: input.planItemId, scheduledFor: dateToDb(date) };
  for (let attempt = 0; attempt < 3; attempt++) {
    const [row, byClient] = await Promise.all([
      db.workoutLog.findFirst({ where: key }),
      db.workoutLog.findFirst({ where: { clientId: input.clientId } }),
    ]);
    if (byClient && (!row || byClient.id !== row.id)) {
      throw new ApiError("conflict", "clientId is already used for a different workout log", [
        { field: "clientId", message: "Reused for another item or date" },
      ]);
    }
    const next = nextStatus(row?.status ?? null, input.action);
    if (next === null) {
      throw new ApiError(
        "conflict",
        row ? `A ${row.status.toLowerCase()} item cannot be ${pastTense(input.action)}` : "Start the item before stopping it",
      );
    }
    const actuals = {
      ...(input.actualSets !== undefined ? { actualSets: input.actualSets } : {}),
      ...(input.actualReps !== undefined ? { actualReps: input.actualReps } : {}),
      ...(input.actualDurationSeconds !== undefined ? { actualDurationSeconds: input.actualDurationSeconds } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
    };
    try {
      if (!row) {
        const created = await db.workoutLog.create({
          data: {
            ...key,
            memberId: assignment.memberId,
            status: next as WorkoutLogStatus,
            startedAt: next === "STARTED" ? occurred : null,
            completedAt: next === "COMPLETED" ? occurred : null,
            clientId: input.clientId,
            recordedById: p.userId,
            ...actuals,
          } as never,
          include,
        });
        return toDto(created);
      }
      const data: Prisma.WorkoutLogUncheckedUpdateManyInput = { ...actuals };
      if (next !== "same") {
        data.status = next;
        data.recordedById = p.userId;
        if (next === "STARTED" && !row.startedAt) data.startedAt = occurred;
        if (next === "COMPLETED") data.completedAt = occurred;
      } else if (Object.keys(actuals).length === 0) {
        return toDto((await db.workoutLog.findFirst({ where: { id: row.id }, include }))!);
      }
      // Guard on the status we read so two devices cannot both pass the same transition.
      const done = await db.workoutLog.updateMany({ where: { id: row.id, status: row.status }, data });
      if (done.count === 0) continue;
      return toDto((await db.workoutLog.findFirst({ where: { id: row.id }, include }))!);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue; // concurrent first write
      throw err;
    }
  }
  throw new ApiError("conflict", "The workout log changed at the same time; try again");
}

function pastTense(a: Action): string {
  return { start: "started", stop: "stopped", complete: "completed", skip: "skipped" }[a];
}
