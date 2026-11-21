import type { GoalMetric, GoalStatus, Prisma } from "@prisma/client";
import { assertCanManageMember, assertCanViewMember } from "../auth/access";
import { ApiError } from "../auth/errors";
import type { Principal } from "../auth/principal";
import type { TenantClient } from "../tenant-scope";
import { Problems, dateFromDb, dateToDb, isDateString, isRecord } from "../workouts/validate";
import { recordMemberUpdates } from "./member-updates";
import { enumParam, tenantDate } from "./pagination";
import { startOfDay } from "./schedule";

const METRICS = ["sessions_attended", "workouts_completed", "level", "custom"] as const;
const STATUSES = ["active", "achieved", "dropped"] as const;
const MAX_CHECK_INS = 20;
/** Decimal(10,2) bound. */
const MAX_VALUE = 99_999_999;

const include = {
  targetLevel: { select: { name: true, rank: true, sportId: true } },
  createdBy: { select: { name: true } },
  checkIns: { orderBy: [{ recordedOn: "desc" as const }, { createdAt: "desc" as const }, { id: "asc" as const }], take: MAX_CHECK_INS },
} satisfies Prisma.GoalInclude;
type Row = Prisma.GoalGetPayload<{ include: typeof include }>;

const num = (d: { toString(): string } | null | undefined): number | null => (d === null || d === undefined ? null : Number(d.toString()));
const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number) => Math.min(100, Math.max(0, n));

/** What progress is measured against, loaded once per member. */
export type ProgressFacts = {
  /** PRESENT attendance: session start instants. */
  presentAt: Date[];
  /** COMPLETED workout logs: scheduled dates (`YYYY-MM-DD`). */
  completedOn: string[];
  /** Levels the member reached: sport, rank and date reached. */
  levels: { sportId: string; rank: number; achievedOn: string }[];
};

export async function loadProgressFacts(db: TenantClient, memberId: string): Promise<ProgressFacts> {
  const [present, done, levels] = await Promise.all([
    db.attendance.findMany({ where: { memberId, status: "PRESENT" }, select: { session: { select: { startsAt: true } } } }),
    db.workoutLog.findMany({ where: { memberId, status: "COMPLETED" }, select: { scheduledFor: true } }),
    db.memberLevel.findMany({ where: { memberId }, select: { achievedOn: true, level: { select: { sportId: true, rank: true } } } }),
  ]);
  return {
    presentAt: present.map((a) => a.session.startsAt),
    completedOn: done.map((l) => dateFromDb(l.scheduledFor)),
    levels: levels.map((m) => ({ sportId: m.level.sportId, rank: m.level.rank, achievedOn: dateFromDb(m.achievedOn) })),
  };
}

export type GoalInputs = {
  metric: GoalMetric;
  status: GoalStatus;
  startsOn: string;
  targetValue: number | null;
  targetSessions: number | null;
  startValue: number | null;
  targetLevel: { rank: number; sportId: string } | null;
  /** Latest check-in value, custom goals. */
  latestCheckIn: number | null;
};

/**
 * Goal progress per docs/PLAN-POC.md 4.3. Returns the current value (null when there is nothing to
 * measure yet) and `progressPercent` in 0..100. ACHIEVED always reports 100; DROPPED reports the
 * last computed value.
 */
export function computeGoalProgress(g: GoalInputs, facts: ProgressFacts): { currentValue: number | null; progressPercent: number } {
  let current: number | null = null;
  let progress = 0;
  if (g.metric === "SESSIONS_ATTENDED") {
    const since = startOfDay(g.startsOn).getTime();
    current = facts.presentAt.filter((d) => d.getTime() >= since).length;
    const target = g.targetValue ?? g.targetSessions;
    progress = target && target > 0 ? clamp((100 * current) / target) : 0;
  } else if (g.metric === "WORKOUTS_COMPLETED") {
    current = facts.completedOn.filter((d) => d >= g.startsOn).length;
    progress = g.targetValue && g.targetValue > 0 ? clamp((100 * current) / g.targetValue) : 0;
  } else if (g.metric === "LEVEL") {
    if (g.targetLevel) {
      const inSport = facts.levels.filter((l) => l.sportId === g.targetLevel!.sportId);
      current = inSport.reduce((m, l) => Math.max(m, l.rank), 0);
      const startRank = inSport.filter((l) => l.achievedOn <= g.startsOn).reduce((m, l) => Math.max(m, l.rank), 0);
      const target = g.targetLevel.rank;
      if (current >= target) progress = 100;
      else if (target > startRank) progress = clamp((100 * (current - startRank)) / (target - startRank));
    }
  } else {
    current = g.latestCheckIn;
    if (current !== null) {
      const start = g.startValue ?? 0;
      const target = g.targetValue;
      if (target !== null) {
        if (target === start) progress = current === target ? 100 : 0;
        else progress = clamp((100 * (current - start)) / (target - start));
      }
    }
  }
  return {
    currentValue: current,
    progressPercent: g.status === "ACHIEVED" ? 100 : round1(progress),
  };
}

function toDto(r: Row, facts: ProgressFacts) {
  const latest = r.checkIns[0] ? num(r.checkIns[0].value) : null;
  const { currentValue, progressPercent } = computeGoalProgress(
    {
      metric: r.metric,
      status: r.status,
      startsOn: dateFromDb(r.startsOn),
      targetValue: num(r.targetValue),
      targetSessions: r.targetSessions,
      startValue: num(r.startValue),
      targetLevel: r.targetLevel ? { rank: r.targetLevel.rank, sportId: r.targetLevel.sportId } : null,
      latestCheckIn: latest,
    },
    facts,
  );
  const isLevel = r.metric === "LEVEL";
  return {
    id: r.id,
    memberId: r.memberId,
    title: r.title,
    metric: r.metric.toLowerCase(),
    status: r.status.toLowerCase(),
    targetValue: isLevel ? (r.targetLevel?.rank ?? null) : (num(r.targetValue) ?? r.targetSessions),
    startValue: num(r.startValue),
    currentValue,
    unit: r.unit,
    targetLevelId: r.targetLevelId,
    targetLevelName: r.targetLevel?.name ?? null,
    targetDate: r.targetDate ? dateFromDb(r.targetDate) : null,
    startsOn: dateFromDb(r.startsOn),
    progressPercent,
    createdById: r.createdById,
    createdByName: r.createdBy?.name ?? null,
    checkIns:
      r.metric === "CUSTOM"
        ? r.checkIns.map((c) => ({ id: c.id, value: num(c.value)!, note: c.note, recordedOn: dateFromDb(c.recordedOn) }))
        : [],
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** GET /members/{memberId}/goals (listGoals): newest first, with computed progress. */
export async function listGoals(db: TenantClient, p: Principal, memberId: string, params: URLSearchParams) {
  await assertCanViewMember(db, p, memberId);
  const status = enumParam(params, "status", STATUSES);
  const rows = await db.goal.findMany({
    where: { memberId, ...(status ? { status: status.toUpperCase() as GoalStatus } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    include,
  });
  const facts = await loadProgressFacts(db, memberId);
  return { items: rows.map((r) => toDto(r, facts)) };
}

async function loadGoalDto(db: TenantClient, id: string) {
  const row = await db.goal.findFirst({ where: { id }, include });
  if (!row) throw new ApiError("not_found", "Goal not found");
  return toDto(row, await loadProgressFacts(db, row.memberId));
}

function numberField(v: Problems, body: Record<string, unknown>, key: string, opts: { min?: number } = {}): number | null | undefined {
  const x = body[key];
  if (x === undefined) return undefined;
  if (x === null) return null;
  if (typeof x !== "number" || !Number.isFinite(x) || Math.abs(x) > MAX_VALUE || x < (opts.min ?? -MAX_VALUE)) {
    v.add(key, opts.min === 0 ? "Number from 0" : "Number");
    return undefined;
  }
  return Math.round(x * 100) / 100;
}

function titleField(v: Problems, body: Record<string, unknown>, required: boolean): string | undefined {
  const t = body.title;
  if (t === undefined && !required) return undefined;
  if (typeof t !== "string" || t.trim().length < 1 || t.length > 120) {
    v.add("title", "Text of 1..120 characters");
    return undefined;
  }
  return t.trim();
}

function unitField(v: Problems, body: Record<string, unknown>): string | null | undefined {
  const u = body.unit;
  if (u === undefined || u === null) return u;
  if (typeof u !== "string" || u.length > 20) {
    v.add("unit", "Text up to 20 characters");
    return undefined;
  }
  return u;
}

function dateField(v: Problems, body: Record<string, unknown>, key: string): string | null | undefined {
  const d = body[key];
  if (d === undefined || d === null) return d;
  if (!isDateString(d)) {
    v.add(key, "Date YYYY-MM-DD");
    return undefined;
  }
  return d;
}

/** POST /members/{memberId}/goals (createGoal). Writes a `goal_set` update for the member. */
export async function createGoal(db: TenantClient, p: Principal, memberId: string, body: unknown, now = new Date()) {
  await assertCanManageMember(db, p, memberId);
  if (!isRecord(body)) throw new ApiError("validation_failed", "Body must be a JSON object");
  const v = new Problems();
  const title = titleField(v, body, true);
  const metricRaw = METRICS.find((m) => m === body.metric);
  if (!metricRaw) v.add("metric", `One of ${METRICS.join(", ")}`);
  const metric = metricRaw?.toUpperCase() as GoalMetric | undefined;
  const targetValue = numberField(v, body, "targetValue", { min: 0 });
  const startValue = numberField(v, body, "startValue");
  const unit = unitField(v, body);
  const targetDate = dateField(v, body, "targetDate");
  const startsOn = dateField(v, body, "startsOn") ?? tenantDate(now);
  let targetLevelId: string | null = null;
  if (body.targetLevelId !== undefined && body.targetLevelId !== null) {
    if (typeof body.targetLevelId !== "string" || !body.targetLevelId) v.add("targetLevelId", "String");
    else targetLevelId = body.targetLevelId;
  }
  if (metric === "SESSIONS_ATTENDED" || metric === "WORKOUTS_COMPLETED") {
    if (targetValue === undefined || targetValue === null || targetValue <= 0) v.add("targetValue", "Required, greater than 0");
  }
  if (metric === "CUSTOM" && (targetValue === undefined || targetValue === null)) v.add("targetValue", "Required for a custom goal");
  if (metric && metric !== "CUSTOM" && startValue !== undefined && startValue !== null) v.add("startValue", "Only for a custom goal");
  if (metric === "LEVEL" && !targetLevelId) v.add("targetLevelId", "Required for a level goal");
  if (metric && metric !== "LEVEL" && targetLevelId) v.add("targetLevelId", "Only for a level goal");
  v.throwIfAny();

  let sportId: string | null = null;
  if (metric === "LEVEL") {
    const level = await db.level.findFirst({ where: { id: targetLevelId! }, select: { sportId: true } });
    if (!level) throw new ApiError("validation_failed", "Target level not found", [{ field: "targetLevelId", message: "Unknown level" }]);
    sportId = level.sportId;
  }

  const id = await db.$transaction(async (raw) => {
    const tx = raw as unknown as TenantClient;
    const goal = await tx.goal.create({
      data: {
        memberId,
        sportId,
        title: title!,
        metric: metric!,
        targetValue: metric === "LEVEL" ? null : (targetValue ?? null),
        // Legacy column kept so getMember's progress bar keeps working for session goals.
        targetSessions: metric === "SESSIONS_ATTENDED" ? Math.round(targetValue!) : null,
        startValue: metric === "CUSTOM" ? (startValue ?? null) : null,
        unit: unit ?? null,
        targetLevelId,
        targetDate: targetDate ? dateToDb(targetDate) : null,
        startsOn: dateToDb(startsOn),
        createdById: p.userId,
      } as never,
      select: { id: true },
    });
    await recordMemberUpdates(tx, {
      memberIds: [memberId],
      kind: "GOAL_SET",
      entityType: "goal",
      entityId: goal.id,
      actorId: p.userId,
      params: { goalTitle: title! },
    });
    return goal.id;
  });
  return loadGoalDto(db, id);
}

/** PATCH /goals/{goalId} (updateGoal). Writes a `goal_updated` update for the member. */
export async function updateGoal(db: TenantClient, p: Principal, goalId: string, body: unknown) {
  const goal = await db.goal.findFirst({ where: { id: goalId }, select: { id: true, memberId: true, metric: true, title: true } });
  if (!goal) throw new ApiError("not_found", "Goal not found");
  await assertCanManageMember(db, p, goal.memberId);
  if (!isRecord(body)) throw new ApiError("validation_failed", "Body must be a JSON object");

  const v = new Problems();
  const title = titleField(v, body, false);
  const targetValue = numberField(v, body, "targetValue", { min: 0 });
  const unit = unitField(v, body);
  const targetDate = dateField(v, body, "targetDate");
  let status: GoalStatus | undefined;
  if (body.status !== undefined) {
    const s = STATUSES.find((x) => x === body.status);
    if (!s) v.add("status", `One of ${STATUSES.join(", ")}`);
    else status = s.toUpperCase() as GoalStatus;
  }
  if (targetValue !== undefined) {
    if (goal.metric === "LEVEL") v.add("targetValue", "A level goal has no numeric target");
    else if (targetValue === null || (goal.metric !== "CUSTOM" && targetValue <= 0)) v.add("targetValue", "Required, greater than 0");
  }
  const sent = ["title", "targetValue", "unit", "targetDate", "status"].some((k) => body[k] !== undefined);
  if (!sent && v.list.length === 0) v.add("body", "Send at least one of title, targetValue, unit, targetDate, status");
  v.throwIfAny();

  await db.$transaction(async (raw) => {
    const tx = raw as unknown as TenantClient;
    await tx.goal.update({
      where: { id: goalId },
      data: {
        ...(title !== undefined ? { title } : {}),
        ...(targetValue !== undefined
          ? { targetValue, ...(goal.metric === "SESSIONS_ATTENDED" ? { targetSessions: Math.round(targetValue!) } : {}) }
          : {}),
        ...(unit !== undefined ? { unit } : {}),
        ...(targetDate !== undefined ? { targetDate: targetDate ? dateToDb(targetDate) : null } : {}),
        ...(status ? { status } : {}),
      },
    });
    await recordMemberUpdates(tx, {
      memberIds: [goal.memberId],
      kind: "GOAL_UPDATED",
      entityType: "goal",
      entityId: goalId,
      actorId: p.userId,
      params: { goalTitle: title ?? goal.title, ...(status ? { status: status.toLowerCase() } : {}) },
    });
  });
  return loadGoalDto(db, goalId);
}

/** POST /goals/{goalId}/check-ins (addGoalCheckIn): custom goals only. Writes a `goal_updated` update. */
export async function addGoalCheckIn(db: TenantClient, p: Principal, goalId: string, body: unknown, now = new Date()) {
  const goal = await db.goal.findFirst({ where: { id: goalId }, select: { id: true, memberId: true, metric: true, title: true } });
  if (!goal) throw new ApiError("not_found", "Goal not found");
  await assertCanManageMember(db, p, goal.memberId);
  if (!isRecord(body)) throw new ApiError("validation_failed", "Body must be a JSON object");

  const v = new Problems();
  const value = numberField(v, body, "value");
  if (value === undefined || value === null) v.add("value", "Required number");
  let note: string | null = null;
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== "string" || body.note.length > 280) v.add("note", "Text up to 280 characters");
    else note = body.note;
  }
  const today = tenantDate(now);
  const recordedOn = dateField(v, body, "recordedOn") ?? today;
  if (recordedOn > today) v.add("recordedOn", "Not in the future");
  if (goal.metric !== "CUSTOM") v.add("metric", "Check-ins are only for goals with metric custom");
  v.throwIfAny();

  await db.$transaction(async (raw) => {
    const tx = raw as unknown as TenantClient;
    await tx.goalCheckIn.create({
      data: { goalId, value: value!, note, recordedOn: dateToDb(recordedOn), recordedById: p.userId } as never,
    });
    await recordMemberUpdates(tx, {
      memberIds: [goal.memberId],
      kind: "GOAL_UPDATED",
      entityType: "goal",
      entityId: goalId,
      actorId: p.userId,
      params: { goalTitle: goal.title, value: String(value) },
    });
  });
  return loadGoalDto(db, goalId);
}
