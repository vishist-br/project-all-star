import { Prisma, type SetType, type WorkoutLogStatus } from "@prisma/client";
import { assertCanManageMember, assertCanViewMember, memberWhere } from "../auth/access";
import { ApiError } from "../auth/errors";
import type { Principal } from "../auth/principal";
import type { TenantClient } from "../tenant-scope";
import {
  HISTORY_RANGES,
  buildRecords,
  buildSeries,
  deriveLogTotals,
  findNewBests,
  rangeStart,
  type HistoryRange,
  type HistorySession,
  type SetLike,
} from "../workouts/records";
import { Problems, dateFromDb, dateToDb, isDateString, isRecord } from "../workouts/validate";
import { CLOCK_SKEW_MS, include as logInclude, nextStatus, toDto as logDto } from "./workout-logs";
import { dateParam, enumParam, pageArgs, tenantDate, toPage } from "./pagination";
import { loadScheduledEntries } from "./schedule";

const SET_TYPES = ["normal", "warmup", "drop", "failure"] as const;
const MAX_SETS = 60;

type SetInput = {
  clientId: string;
  setNumber: number;
  setType: SetType;
  weightKg: number | null;
  reps: number | null;
  seconds: number | null;
  meters: number | null;
  scoreMade: number | null;
  scoreOf: number | null;
  rating: number | null;
  completedAt: Date | null;
};

type Input = {
  clientId: string;
  assignmentId: string;
  planItemId: string;
  memberId: string | null;
  scheduledFor: string;
  note: string | null | undefined;
  complete: boolean;
  sets: SetInput[];
};

type SetRow = {
  id: string;
  logId: string;
  clientId: string;
  setNumber: number;
  setType: SetType;
  weightKg: { toString(): string } | null;
  reps: number | null;
  seconds: number | null;
  meters: number | null;
  scoreMade: number | null;
  scoreOf: number | null;
  rating: number | null;
  completedAt: Date;
};

export function setDto(r: SetRow) {
  return {
    id: r.id,
    logId: r.logId,
    clientId: r.clientId,
    setNumber: r.setNumber,
    setType: r.setType.toLowerCase(),
    weightKg: r.weightKg === null ? null : Number(r.weightKg.toString()),
    reps: r.reps,
    seconds: r.seconds,
    meters: r.meters,
    scoreMade: r.scoreMade,
    scoreOf: r.scoreOf,
    rating: r.rating,
    completedAt: r.completedAt.toISOString(),
  };
}

const toSetLike = (r: SetRow): SetLike => ({
  setType: r.setType,
  weightKg: r.weightKg === null ? null : Number(r.weightKg.toString()),
  reps: r.reps,
  seconds: r.seconds,
  meters: r.meters,
  scoreMade: r.scoreMade,
  scoreOf: r.scoreOf,
});

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
  let note: string | null | undefined;
  if (body.note === null) note = null;
  else if (body.note !== undefined) {
    if (typeof body.note !== "string" || body.note.length > 280) v.add("note", "Text up to 280 characters");
    else note = body.note;
  }
  if (body.complete !== undefined && typeof body.complete !== "boolean") v.add("complete", "Boolean");

  const sets: SetInput[] = [];
  if (!Array.isArray(body.sets) || body.sets.length < 1 || body.sets.length > MAX_SETS) {
    v.add("sets", `1..${MAX_SETS} sets`);
  } else {
    const nums = new Set<number>();
    const clients = new Set<string>();
    body.sets.forEach((raw, i) => {
      const path = `sets[${i}]`;
      if (!isRecord(raw)) return v.add(path, "Object expected");
      const int = (k: string, min: number, max: number): number | null => {
        const x = raw[k];
        if (x === undefined || x === null) return null;
        if (typeof x !== "number" || !Number.isInteger(x) || x < min || x > max) {
          v.add(`${path}.${k}`, `Integer ${min}..${max}`);
          return null;
        }
        return x;
      };
      const sClient = raw.clientId;
      if (typeof sClient !== "string" || sClient.length < 8 || sClient.length > 64) v.add(`${path}.clientId`, "String of 8..64 characters");
      else if (clients.has(sClient)) v.add(`${path}.clientId`, "Duplicate clientId in this request");
      else clients.add(sClient);
      const setNumber = int("setNumber", 1, 200);
      if (setNumber === null) v.add(`${path}.setNumber`, "Required integer 1..200");
      else if (nums.has(setNumber)) v.add(`${path}.setNumber`, "Duplicate setNumber in this request");
      else nums.add(setNumber);
      let setType: SetType = "NORMAL";
      if (raw.setType !== undefined && raw.setType !== null) {
        if ((SET_TYPES as readonly unknown[]).includes(raw.setType)) setType = (raw.setType as string).toUpperCase() as SetType;
        else v.add(`${path}.setType`, `One of ${SET_TYPES.join(", ")}`);
      }
      let weightKg: number | null = null;
      if (raw.weightKg !== undefined && raw.weightKg !== null) {
        if (typeof raw.weightKg === "number" && raw.weightKg >= 0 && raw.weightKg <= 1000) weightKg = Math.round(raw.weightKg * 100) / 100;
        else v.add(`${path}.weightKg`, "Number 0..1000");
      }
      const reps = int("reps", 0, 1000);
      const seconds = int("seconds", 0, 86_400);
      const meters = int("meters", 0, 100_000);
      const scoreMade = int("scoreMade", 0, 10_000);
      const scoreOf = int("scoreOf", 1, 10_000);
      if ((scoreMade === null) !== (scoreOf === null)) v.add(`${path}.scoreMade`, "scoreMade and scoreOf go together");
      else if (scoreMade !== null && scoreOf !== null && scoreMade > scoreOf) v.add(`${path}.scoreMade`, "Cannot be more than scoreOf");
      const rating = int("rating", 1, 4);
      if (weightKg === null && reps === null && seconds === null && meters === null && scoreMade === null && rating === null) {
        v.add(path, "Give at least one of weightKg, reps, seconds, meters, scoreMade/scoreOf, rating");
      }
      let completedAt: Date | null = null;
      if (raw.completedAt !== undefined && raw.completedAt !== null) {
        const d = typeof raw.completedAt === "string" && /^\d{4}-\d{2}-\d{2}T/.test(raw.completedAt) ? new Date(raw.completedAt) : null;
        if (!d || Number.isNaN(d.getTime())) v.add(`${path}.completedAt`, "ISO date-time");
        else completedAt = d;
      }
      sets.push({ clientId: typeof sClient === "string" ? sClient : "", setNumber: setNumber ?? 0, setType, weightKg, reps, seconds, meters, scoreMade, scoreOf, rating, completedAt });
    });
  }
  v.throwIfAny();
  return { clientId, assignmentId, planItemId, memberId, scheduledFor, note, complete: body.complete === true, sets };
}

type LoggedSession = { logId: string; date: string; status: WorkoutLogStatus; note: string | null; rows: SetRow[] };

/** History of one member for several exercises in one query: every set row with its log date, oldest first, per exercise. */
async function loadHistories(db: TenantClient, memberId: string, exerciseIds: readonly string[]) {
  const out = new Map<string, LoggedSession[]>(exerciseIds.map((id) => [id, []]));
  if (exerciseIds.length === 0) return out;
  const rows = await db.workoutSet.findMany({
    where: { log: { memberId, planItem: { exerciseId: { in: [...exerciseIds] } } } },
    include: { log: { select: { id: true, scheduledFor: true, status: true, note: true, planItem: { select: { exerciseId: true } } } } },
    orderBy: [{ log: { scheduledFor: "asc" } }, { setNumber: "asc" }, { completedAt: "asc" }, { id: "asc" }],
  });
  const byLog = new Map<string, LoggedSession>();
  const exerciseOf = new Map<string, string>();
  for (const r of rows) {
    const cur = byLog.get(r.logId) ?? { logId: r.logId, date: dateFromDb(r.log.scheduledFor), status: r.log.status, note: r.log.note, rows: [] };
    cur.rows.push(r);
    if (!byLog.has(r.logId)) {
      byLog.set(r.logId, cur);
      exerciseOf.set(r.logId, r.log.planItem.exerciseId);
    }
  }
  for (const [logId, sess] of byLog) out.get(exerciseOf.get(logId)!)!.push(sess);
  return out;
}

/** History of one member and exercise: every set row with its log date, oldest first. */
async function loadHistory(db: TenantClient, memberId: string, exerciseId: string) {
  return (await loadHistories(db, memberId, [exerciseId])).get(exerciseId) ?? [];
}

/**
 * PUT /workout-sets (recordWorkoutSets). Idempotent batch upsert by set `clientId`; creates the log for
 * (assignment, item, date) when it does not exist yet (status started). With `complete: true` the log
 * becomes completed. Log totals (actualSets, actualReps, actualDurationSeconds) are derived from the
 * sets. Returns the log with all its sets and the records this log broke.
 */
export async function recordWorkoutSets(db: TenantClient, p: Principal, body: unknown, now = new Date()) {
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
  const scheduled = await loadScheduledEntries(db, [assignment.memberId], input.scheduledFor, input.scheduledFor);
  const entry = scheduled.find((e) => e.assignmentId === assignment.id && e.item.id === input.planItemId);
  if (!entry) {
    throw new ApiError("validation_failed", "This item is not scheduled for the member on that date", [{ field: "planItemId", message: "Not scheduled on scheduledFor" }]);
  }

  const key = { assignmentId: assignment.id, planItemId: input.planItemId, scheduledFor: dateToDb(input.scheduledFor) };
  let logId = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      logId = await db.$transaction(async (raw) => {
        const tx = raw as unknown as TenantClient;
        const [row, byClient] = await Promise.all([tx.workoutLog.findFirst({ where: key }), tx.workoutLog.findFirst({ where: { clientId: input.clientId } })]);
        if (byClient && (!row || byClient.id !== row.id)) {
          throw new ApiError("conflict", "clientId is already used for a different workout log", [{ field: "clientId", message: "Reused for another item or date" }]);
        }
        if (row?.status === "SKIPPED") throw new ApiError("conflict", "A skipped item cannot take sets");
        const log =
          row ??
          (await tx.workoutLog.create({
            data: { ...key, memberId: assignment.memberId, status: "STARTED", startedAt: now, clientId: input.clientId, recordedById: p.userId } as never,
          }));

        const existing = await tx.workoutSet.findMany({ where: { clientId: { in: input.sets.map((s) => s.clientId) } } });
        const known = new Map(existing.map((e) => [e.clientId, e]));
        for (const e of existing) {
          if (e.logId !== log.id) throw new ApiError("conflict", "A set clientId is already used for a different workout log", [{ field: "sets.clientId", message: "Reused for another log" }]);
        }
        const fresh: Prisma.WorkoutSetCreateManyInput[] = [];
        for (const s of input.sets) {
          const completedAt = s.completedAt ? new Date(Math.min(s.completedAt.getTime(), now.getTime() + CLOCK_SKEW_MS)) : now;
          const data = {
            setNumber: s.setNumber,
            setType: s.setType,
            weightKg: s.weightKg,
            reps: s.reps,
            seconds: s.seconds,
            meters: s.meters,
            scoreMade: s.scoreMade,
            scoreOf: s.scoreOf,
            rating: s.rating,
            completedAt,
          };
          const have = known.get(s.clientId);
          if (!have) fresh.push({ ...data, logId: log.id, clientId: s.clientId } as Prisma.WorkoutSetCreateManyInput);
          else await tx.workoutSet.update({ where: { id: have.id }, data });
        }
        if (fresh.length) await tx.workoutSet.createMany({ data: fresh, skipDuplicates: true });

        // Totals derived from every set of the log, then the status move (complete) and the note.
        const all = await tx.workoutSet.findMany({ where: { logId: log.id } });
        const totals = deriveLogTotals(all.map(toSetLike));
        const data: Prisma.WorkoutLogUncheckedUpdateManyInput = { ...totals, recordedById: p.userId };
        if (input.note !== undefined) data.note = input.note;
        if (input.complete) {
          const next = nextStatus(log.status, "complete");
          if (next === null) throw new ApiError("conflict", `A ${log.status.toLowerCase()} item cannot be completed`);
          if (next !== "same") {
            data.status = next;
            data.completedAt = now;
          }
        }
        await tx.workoutLog.updateMany({ where: { id: log.id }, data });
        return log.id;
      });
      break;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" && attempt < 2) continue; // concurrent first write
      throw err;
    }
  }

  const [log, sets, history] = await Promise.all([
    db.workoutLog.findFirst({ where: { id: logId }, include: logInclude }),
    db.workoutSet.findMany({ where: { logId }, orderBy: [{ setNumber: "asc" }, { completedAt: "asc" }, { id: "asc" }] }),
    loadHistory(db, assignment.memberId, entry.item.exerciseId),
  ]);
  const sessions: HistorySession[] = history.map((h) => ({ logId: h.logId, date: h.date, sets: h.rows.map(toSetLike) }));
  return {
    ...logDto(log!),
    sets: sets.map(setDto),
    newBests: findNewBests(sessions, new Set([logId])).map(({ metric, value, previous }) => ({ metric, value, previous })),
  };
}

/** GET /members/{memberId}/workout-sets (listWorkoutSets). Newest day first, sets in order within a log. */
export async function listWorkoutSets(db: TenantClient, p: Principal, memberId: string, params: URLSearchParams) {
  await assertCanViewMember(db, p, memberId);
  const { limit, args } = pageArgs(params);
  const from = params.get("from");
  const to = params.get("to");
  dateParam(params, "from");
  dateParam(params, "to");
  const logId = params.get("logId");
  const exerciseId = params.get("exerciseId");
  const rows = await db.workoutSet.findMany({
    where: {
      log: {
        memberId,
        ...(logId ? { id: logId } : {}),
        ...(exerciseId ? { planItem: { exerciseId } } : {}),
        ...(from || to ? { scheduledFor: { ...(from ? { gte: dateToDb(from) } : {}), ...(to ? { lte: dateToDb(to) } : {}) } } : {}),
      },
    },
    orderBy: [{ log: { scheduledFor: "desc" } }, { logId: "asc" }, { setNumber: "asc" }, { id: "asc" }],
    include: { log: { select: { scheduledFor: true, planItem: { select: { exerciseId: true, exercise: { select: { name: true } } } } } } },
    ...args,
  });
  const page = toPage(rows, limit);
  return {
    items: page.rows.map((r) => ({
      ...setDto(r),
      scheduledFor: dateFromDb(r.log.scheduledFor),
      exerciseId: r.log.planItem.exerciseId,
      exerciseName: r.log.planItem.exercise.name,
    })),
    nextCursor: page.nextCursor,
  };
}

/** GET /members/{memberId}/exercises/{exerciseId}/history (getExerciseHistory). */
export async function getExerciseHistory(db: TenantClient, p: Principal, memberId: string, exerciseId: string, params: URLSearchParams, now = new Date()) {
  const [one] = await getExerciseHistories(db, p, memberId, [exerciseId], params, now, true);
  return one!;
}

/**
 * getExerciseHistory for several exercises of one member with a fixed number of queries (STAR-102): the
 * overview of every logged exercise no longer costs three queries per exercise. Same shape and order as the
 * input ids; an unknown exercise id is a 404 when `strict`, and skipped otherwise.
 */
export async function getExerciseHistories(
  db: TenantClient,
  p: Principal,
  memberId: string,
  exerciseIds: readonly string[],
  params: URLSearchParams,
  now = new Date(),
  strict = false,
) {
  await assertCanViewMember(db, p, memberId);
  const range = (enumParam(params, "range", HISTORY_RANGES) ?? "3m") as HistoryRange;
  const start = rangeStart(range, tenantDate(now));
  const ids = [...new Set(exerciseIds)];
  const [exercises, histories] = await Promise.all([
    db.exercise.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, metricType: true } }),
    loadHistories(db, memberId, ids),
  ]);
  const byId = new Map(exercises.map((e) => [e.id, e]));
  const out: ReturnType<typeof buildExerciseHistory>[] = [];
  for (const id of ids) {
    const exercise = byId.get(id);
    if (!exercise) {
      if (strict) throw new ApiError("not_found", "Exercise not found");
      continue;
    }
    out.push(buildExerciseHistory(memberId, exercise, histories.get(id) ?? [], range, start));
  }
  return out;
}

function buildExerciseHistory(
  memberId: string,
  exercise: { id: string; name: string; metricType: string },
  history: LoggedSession[],
  range: HistoryRange,
  start: string | null,
) {
  const all: HistorySession[] = history.map((h) => ({ logId: h.logId, date: h.date, sets: h.rows.map(toSetLike) }));
  const inRange = history.filter((h) => start === null || h.date >= start);
  const inRangeSessions = all.filter((s) => start === null || s.date >= start);
  const rangeIds = new Set(inRangeSessions.map((s) => s.logId));

  return {
    memberId,
    exerciseId: exercise.id,
    exerciseName: exercise.name,
    metricType: exercise.metricType,
    range,
    from: start,
    // Newest session first; the series below are oldest first for charts.
    sessions: [...inRange].reverse().map((h) => ({
      logId: h.logId,
      date: h.date,
      status: h.status.toLowerCase(),
      note: h.note,
      sets: h.rows.map(setDto),
    })),
    series: buildSeries(inRangeSessions),
    // Records look at the whole history: a best is a best whatever range the chart shows.
    records: buildRecords(all),
    newBests: findNewBests(all, rangeIds),
  };
}
