import type { PlanCadence, PlanStatus, Prisma } from "@prisma/client";
import { assertCanEditPlan, planViewWhere, planWhere } from "../auth/access";
import { ApiError } from "../auth/errors";
import type { Principal } from "../auth/principal";
import type { TenantClient } from "../tenant-scope";
import { expandPlanDay, validateSupersets } from "../workouts/supersets";
import { Problems, dateToDb, intField, isRecord, textField } from "../workouts/validate";
import { recordMemberUpdates } from "./member-updates";
import { enumParam, pageArgs, tenantDate, toPage } from "./pagination";

const CADENCES = ["daily", "weekly", "monthly"] as const;
const PLAN_STATUSES = ["draft", "active", "archived"] as const;
const INPUT_STATUSES = ["draft", "active"] as const;
const MAX_DAY: Record<(typeof CADENCES)[number], number> = { daily: 1, weekly: 7, monthly: 31 };

const lower = <T extends string>(s: T) => s.toLowerCase() as Lowercase<T>;

// ---- input ----

type ItemInput = {
  id?: string;
  exerciseId: string;
  position: number;
  sets: number | null;
  reps: number | null;
  durationSeconds: number | null;
  restSeconds: number | null;
  supersetGroup: string | null;
  rounds: number | null;
  targetWeightKg: number | null;
  targetDistanceMeters: number | null;
  notes: string | null;
};
type DayInput = { dayIndex: number; title: string | null; notes: string | null; items: ItemInput[] };
export type PlanInput = {
  title: string;
  description: string | null;
  cadence: (typeof CADENCES)[number];
  sportSlug: string | null;
  status: "draft" | "active";
  days: DayInput[];
  expectedVersion?: number;
};

/** Shape and range checks from the contract (WorkoutPlanInput). Exercise existence is checked separately. */
export function parsePlanInput(body: unknown, requireVersion: boolean): PlanInput {
  const p = new Problems();
  if (!isRecord(body)) throw new ApiError("validation_failed", "Body must be a JSON object");

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (title.length < 1 || title.length > 80) p.add("title", "Text 1..80 characters");
  const description = textField(p, body, "description", "", 1000);
  const cadence = body.cadence;
  if (!(CADENCES as readonly unknown[]).includes(cadence)) p.add("cadence", `One of ${CADENCES.join(", ")}`);
  let sportSlug: string | null = null;
  if (body.sportSlug !== undefined && body.sportSlug !== null) {
    if (typeof body.sportSlug === "string" && body.sportSlug.length > 0 && body.sportSlug.length <= 60) sportSlug = body.sportSlug;
    else p.add("sportSlug", "Sport slug or null");
  }
  let status: "draft" | "active" = "active";
  if (body.status !== undefined) {
    if ((INPUT_STATUSES as readonly unknown[]).includes(body.status)) status = body.status as "draft" | "active";
    else p.add("status", "One of draft, active");
  }
  let expectedVersion: number | undefined;
  if (requireVersion) {
    if (typeof body.expectedVersion === "number" && Number.isInteger(body.expectedVersion) && body.expectedVersion >= 1) {
      expectedVersion = body.expectedVersion;
    } else p.add("expectedVersion", "Integer >= 1");
  }

  const days: DayInput[] = [];
  if (!Array.isArray(body.days) || body.days.length < 1 || body.days.length > 31) {
    p.add("days", "1..31 days");
  } else {
    const seen = new Set<number>();
    const max = (CADENCES as readonly unknown[]).includes(cadence) ? MAX_DAY[cadence as (typeof CADENCES)[number]] : 31;
    body.days.forEach((raw, i) => {
      const path = `days[${i}]`;
      if (!isRecord(raw)) return p.add(path, "Object expected");
      const dayIndex = raw.dayIndex;
      if (typeof dayIndex !== "number" || !Number.isInteger(dayIndex) || dayIndex < 1 || dayIndex > max) {
        p.add(`${path}.dayIndex`, `Integer 1..${max} for a ${String(cadence)} plan`);
      } else if (seen.has(dayIndex)) p.add(`${path}.dayIndex`, "Duplicate day");
      else seen.add(dayIndex);
      const dayTitle = textField(p, raw, "title", path, 80);
      const dayNotes = textField(p, raw, "notes", path, 500);
      const items: ItemInput[] = [];
      if (!Array.isArray(raw.items) || raw.items.length > 30) {
        p.add(`${path}.items`, "Array of up to 30 items");
      } else {
        const positions = new Set<number>();
        raw.items.forEach((it, j) => {
          const ip = `${path}.items[${j}]`;
          if (!isRecord(it)) return p.add(ip, "Object expected");
          if (typeof it.exerciseId !== "string" || it.exerciseId.length === 0) p.add(`${ip}.exerciseId`, "Required");
          const position = it.position;
          if (typeof position !== "number" || !Number.isInteger(position) || position < 1) p.add(`${ip}.position`, "Integer >= 1");
          else if (positions.has(position)) p.add(`${ip}.position`, "Duplicate position");
          else positions.add(position);
          const sets = intField(p, it, "sets", ip, 1, 20);
          const reps = intField(p, it, "reps", ip, 1, 200);
          const durationSeconds = intField(p, it, "durationSeconds", ip, 1, 7200);
          const restSeconds = intField(p, it, "restSeconds", ip, 0, 900);
          const targetDistanceMeters = intField(p, it, "targetDistanceMeters", ip, 1, 100_000);
          if (reps === null && durationSeconds === null && targetDistanceMeters === null) {
            p.add(ip, "reps or durationSeconds is required (targetDistanceMeters also works for distance work)");
          }
          const rounds = intField(p, it, "rounds", ip, 1, 20);
          let supersetGroup: string | null = null;
          if (it.supersetGroup !== undefined && it.supersetGroup !== null) {
            if (typeof it.supersetGroup === "string" && it.supersetGroup.length > 0) supersetGroup = it.supersetGroup;
            else p.add(`${ip}.supersetGroup`, "Label such as A, or null");
          }
          let targetWeightKg: number | null = null;
          if (it.targetWeightKg !== undefined && it.targetWeightKg !== null) {
            if (typeof it.targetWeightKg === "number" && it.targetWeightKg > 0 && it.targetWeightKg <= 1000) {
              targetWeightKg = Math.round(it.targetWeightKg * 100) / 100;
            } else p.add(`${ip}.targetWeightKg`, "Number above 0, up to 1000");
          }
          const notes = textField(p, it, "notes", ip, 280);
          items.push({
            ...(typeof it.id === "string" ? { id: it.id } : {}),
            exerciseId: typeof it.exerciseId === "string" ? it.exerciseId : "",
            position: typeof position === "number" ? position : 0,
            sets,
            reps,
            durationSeconds,
            restSeconds,
            supersetGroup,
            rounds,
            targetWeightKg,
            targetDistanceMeters,
            notes,
          });
        });
        validateSupersets(items).forEach((pr) => p.add(`${path}.items[${pr.index}].${pr.field}`, pr.message));
      }
      days.push({ dayIndex: typeof dayIndex === "number" ? dayIndex : 0, title: dayTitle, notes: dayNotes, items });
    });
  }
  p.throwIfAny();
  return {
    title,
    description,
    cadence: cadence as PlanInput["cadence"],
    sportSlug,
    status,
    days,
    ...(expectedVersion !== undefined ? { expectedVersion } : {}),
  };
}

/** Every exercise id must belong to the caller's tenant (scoped client), else 400. */
async function assertExercisesExist(db: TenantClient, input: PlanInput): Promise<void> {
  const ids = [...new Set(input.days.flatMap((d) => d.items.map((i) => i.exerciseId)))];
  if (ids.length === 0) return;
  const found = new Set((await db.exercise.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((e) => e.id));
  const p = new Problems();
  input.days.forEach((d, i) =>
    d.items.forEach((it, j) => {
      if (!found.has(it.exerciseId)) p.add(`days[${i}].items[${j}].exerciseId`, "Unknown exercise");
    }),
  );
  p.throwIfAny();
}

// ---- output ----

const planInclude = {
  coach: { select: { name: true } },
  days: {
    orderBy: { dayIndex: "asc" },
    include: {
      items: { orderBy: [{ position: "asc" }, { id: "asc" }], include: { exercise: { select: { name: true, metricType: true } } } },
    },
  },
  _count: { select: { assignments: { where: { status: "ACTIVE" } } } },
} satisfies Prisma.WorkoutPlanInclude;

type PlanRow = Prisma.WorkoutPlanGetPayload<{ include: typeof planInclude }>;

export function planItemDto(i: {
  id: string;
  exerciseId: string;
  exercise: { name: string; metricType: string };
  position: number;
  sets: number | null;
  reps: number | null;
  durationSeconds: number | null;
  restSeconds: number | null;
  supersetGroup: string | null;
  rounds: number | null;
  targetWeightKg: { toString(): string } | null;
  targetDistanceMeters: number | null;
  notes: string | null;
}) {
  return {
    id: i.id,
    exerciseId: i.exerciseId,
    exerciseName: i.exercise.name,
    metricType: i.exercise.metricType,
    position: i.position,
    sets: i.sets,
    reps: i.reps,
    durationSeconds: i.durationSeconds,
    restSeconds: i.restSeconds,
    supersetGroup: i.supersetGroup,
    rounds: i.rounds,
    targetWeightKg: i.targetWeightKg === null ? null : Number(i.targetWeightKg.toString()),
    targetDistanceMeters: i.targetDistanceMeters,
    notes: i.notes,
  };
}

export function planDto(plan: PlanRow) {
  return {
    id: plan.id,
    title: plan.title,
    description: plan.description,
    cadence: lower(plan.cadence),
    sportSlug: plan.sportSlug,
    status: lower(plan.status),
    version: plan.version,
    folderId: plan.folderId,
    isTemplate: plan.isTemplate,
    coachId: plan.coachId,
    coachName: plan.coach.name,
    activeAssignmentCount: plan._count.assignments,
    updatedAt: plan.updatedAt.toISOString(),
    // Items edited away are archived and kept for history; days left with only archived items are hidden.
    days: plan.days
      .filter((d) => d.items.length === 0 || d.items.some((i) => !i.archivedAt))
      .map((d) => ({
        id: d.id,
        dayIndex: d.dayIndex,
        title: d.title,
        notes: d.notes,
        ...(() => {
          const items = d.items.filter((i) => !i.archivedAt).map(planItemDto);
          return { items, blocks: expandPlanDay(items) };
        })(),
      })),
  };
}

async function loadPlanDto(db: TenantClient, id: string) {
  const row = await db.workoutPlan.findFirst({ where: { id }, include: planInclude });
  if (!row) throw new ApiError("not_found", "Plan not found");
  return planDto(row);
}

// ---- operations ----

/** GET /workout-plans (listWorkoutPlans). Owner all, coach own. */
export async function listWorkoutPlans(db: TenantClient, p: Principal, params: URLSearchParams) {
  const { limit, args } = pageArgs(params);
  const and: Prisma.WorkoutPlanWhereInput[] = [planWhere(p)];
  const status = enumParam(params, "status", PLAN_STATUSES);
  if (status) and.push({ status: status.toUpperCase() as PlanStatus });
  const q = params.get("q")?.trim();
  if (q) and.push({ title: { contains: q, mode: "insensitive" } });
  // Templates are starting points, listed by listPlanTemplates; the plan list holds real plans only.
  and.push({ isTemplate: false });
  const folderId = params.get("folderId");
  if (folderId) and.push({ folderId: folderId === "none" ? null : folderId });
  const rows = await db.workoutPlan.findMany({
    where: { AND: and },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    include: summaryInclude,
    ...args,
  });
  const page = toPage(rows, limit);
  return {
    items: page.rows.map(planSummaryDto),
    nextCursor: page.nextCursor,
  };
}

const summaryInclude = {
  coach: { select: { name: true } },
  days: { select: { items: { select: { archivedAt: true } } } },
  _count: { select: { assignments: { where: { status: "ACTIVE" } } } },
} satisfies Prisma.WorkoutPlanInclude;

export function planSummaryDto(r: Prisma.WorkoutPlanGetPayload<{ include: typeof summaryInclude }>) {
  const live = r.days.map((d) => d.items.filter((i) => !i.archivedAt).length);
  return {
    id: r.id,
    title: r.title,
    cadence: lower(r.cadence),
    status: lower(r.status),
    version: r.version,
    folderId: r.folderId,
    isTemplate: r.isTemplate,
    coachId: r.coachId,
    coachName: r.coach.name,
    dayCount: r.days.filter((d, i) => d.items.length === 0 || live[i] > 0).length,
    itemCount: live.reduce((a, b) => a + b, 0),
    activeAssignmentCount: r._count.assignments,
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** GET /plan-templates (listPlanTemplates): the caller's own templates (owner: every template), newest first. */
export async function listPlanTemplates(db: TenantClient, p: Principal) {
  const rows = await db.workoutPlan.findMany({
    where: { AND: [planWhere(p), { isTemplate: true, status: { not: "ARCHIVED" } }] },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    include: summaryInclude,
    take: 100,
  });
  return { items: rows.map(planSummaryDto) };
}

/**
 * POST /workout-plans/{planId}/duplicate (duplicatePlan). Copies the plan's live days and items into a
 * new plan owned by the caller. `asTemplate: true` saves a template; copying a template with
 * `asTemplate: false` (the default) makes a real plan from it ("use template"). The copy is a
 * fresh plan: version 1, no assignments, same folder unless `folderId` says otherwise.
 */
export async function duplicatePlan(db: TenantClient, p: Principal, planId: string, body: unknown) {
  const input = body === undefined || body === null ? {} : body;
  if (!isRecord(input)) throw new ApiError("validation_failed", "Body must be a JSON object");
  const v = new Problems();
  let title: string | null = null;
  if (input.title !== undefined && input.title !== null) {
    if (typeof input.title === "string" && input.title.trim().length >= 1 && input.title.trim().length <= 80) title = input.title.trim();
    else v.add("title", "Text 1..80 characters");
  }
  let asTemplate = false;
  if (input.asTemplate !== undefined) {
    if (typeof input.asTemplate === "boolean") asTemplate = input.asTemplate;
    else v.add("asTemplate", "Boolean");
  }
  let folderId: string | null | undefined;
  if (input.folderId !== undefined) {
    if (input.folderId === null || (typeof input.folderId === "string" && input.folderId.length > 0)) folderId = input.folderId as string | null;
    else v.add("folderId", "Folder id or null");
  }
  v.throwIfAny();

  await assertCanEditPlan(db, p, planId);
  const src = await db.workoutPlan.findFirst({
    where: { id: planId },
    include: { days: { orderBy: { dayIndex: "asc" }, include: { items: { where: { archivedAt: null }, orderBy: [{ position: "asc" }, { id: "asc" }] } } } },
  });
  if (!src) throw new ApiError("not_found", "Plan not found");
  if (folderId) await assertFolderUsable(db, p, folderId);

  const fromTemplate = src.isTemplate && !asTemplate;
  const finalTitle = title ?? (fromTemplate ? src.title : `${src.title.slice(0, 73)} (copy)`);
  const days = src.days.filter((d) => d.items.length > 0);
  const created = await db.workoutPlan.create({
    data: {
      coachId: p.userId,
      title: finalTitle,
      description: src.description,
      cadence: src.cadence,
      sportSlug: src.sportSlug,
      status: src.status === "ARCHIVED" ? "ACTIVE" : src.status,
      isTemplate: asTemplate,
      folderId: folderId === undefined ? (fromTemplate || asTemplate ? null : src.folderId) : folderId,
      days: {
        create: days.map((d) => ({
          tenantId: p.tenantId,
          dayIndex: d.dayIndex,
          title: d.title,
          notes: d.notes,
          items: {
            create: d.items.map((i) => ({
              tenantId: p.tenantId,
              exerciseId: i.exerciseId,
              position: i.position,
              sets: i.sets,
              reps: i.reps,
              durationSeconds: i.durationSeconds,
              restSeconds: i.restSeconds,
              supersetGroup: i.supersetGroup,
              rounds: i.rounds,
              targetWeightKg: i.targetWeightKg,
              targetDistanceMeters: i.targetDistanceMeters,
              notes: i.notes,
            })),
          },
        })),
      },
    } as never,
    select: { id: true },
  });
  return loadPlanDto(db, created.id);
}

/** A folder the caller may file plans in: owner any folder of the business, coach only their own. */
export async function assertFolderUsable(db: TenantClient, p: Principal, folderId: string): Promise<void> {
  const row = await db.planFolder.findFirst({ where: { id: folderId }, select: { coachId: true } });
  if (!row) throw new ApiError("not_found", "Folder not found");
  if (p.role !== "owner" && row.coachId !== p.userId) throw new ApiError("forbidden", "This folder is not yours");
}

/** PUT /workout-plans/{planId}/folder (movePlanToFolder). `folderId: null` takes the plan out of its folder. */
export async function movePlanToFolder(db: TenantClient, p: Principal, planId: string, body: unknown) {
  if (!isRecord(body) || !("folderId" in body)) throw new ApiError("validation_failed", "Body must be an object with folderId", [{ field: "folderId", message: "Folder id or null" }]);
  const folderId = body.folderId;
  if (folderId !== null && (typeof folderId !== "string" || folderId.length === 0)) {
    throw new ApiError("validation_failed", "folderId must be a folder id or null", [{ field: "folderId", message: "Folder id or null" }]);
  }
  await assertCanEditPlan(db, p, planId);
  if (folderId !== null) await assertFolderUsable(db, p, folderId as string);
  await db.workoutPlan.update({ where: { id: planId }, data: { folderId: folderId as string | null } });
  const row = await db.workoutPlan.findFirst({ where: { id: planId }, include: summaryInclude });
  if (!row) throw new ApiError("not_found", "Plan not found");
  return planSummaryDto(row);
}

/** POST /workout-plans (createWorkoutPlan). The caller (owner or coach) is the creator. */
export async function createWorkoutPlan(db: TenantClient, p: Principal, body: unknown) {
  const input = parsePlanInput(body, false);
  await assertExercisesExist(db, input);
  const created = await db.workoutPlan.create({
    data: {
      coachId: p.userId,
      title: input.title,
      description: input.description,
      cadence: input.cadence.toUpperCase() as PlanCadence,
      sportSlug: input.sportSlug,
      status: input.status.toUpperCase() as PlanStatus,
      days: {
        create: input.days.map((d) => ({
          tenantId: p.tenantId,
          dayIndex: d.dayIndex,
          title: d.title,
          notes: d.notes,
          items: {
            create: d.items.map((i) => ({
              tenantId: p.tenantId,
              exerciseId: i.exerciseId,
              position: i.position,
              sets: i.sets,
              reps: i.reps,
              durationSeconds: i.durationSeconds,
              restSeconds: i.restSeconds,
              supersetGroup: i.supersetGroup,
              rounds: i.rounds,
              targetWeightKg: i.targetWeightKg,
              targetDistanceMeters: i.targetDistanceMeters,
              notes: i.notes,
            })),
          },
        })),
      },
    } as never,
    select: { id: true },
  });
  return loadPlanDto(db, created.id);
}

export type PlanBrief = { id: string; title: string; description: string | null; days: { items: { exerciseName: string }[] }[] };

/**
 * Title, description and exercise names of several plans in one round of queries (STAR-102), for cards
 * that preview many plans at once. Same visibility as getWorkoutPlan: plans outside the caller's view
 * are simply absent from the map instead of throwing.
 */
export async function getPlanBriefs(db: TenantClient, p: Principal, planIds: readonly string[]): Promise<Map<string, PlanBrief>> {
  const out = new Map<string, PlanBrief>();
  if (planIds.length === 0) return out;
  const rows = await db.workoutPlan.findMany({
    where: { id: { in: [...new Set(planIds)] }, ...planViewWhere(p) },
    select: {
      id: true,
      title: true,
      description: true,
      days: {
        orderBy: { dayIndex: "asc" },
        select: { items: { where: { archivedAt: null }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { exercise: { select: { name: true } } } } },
      },
    },
  });
  for (const r of rows) {
    out.set(r.id, { id: r.id, title: r.title, description: r.description, days: r.days.map((d) => ({ items: d.items.map((i) => ({ exerciseName: i.exercise.name })) })) });
  }
  return out;
}

/** GET /workout-plans/{id} (getWorkoutPlan). 404 other tenant, 403 outside the caller's view. */
export async function getWorkoutPlan(db: TenantClient, p: Principal, planId: string) {
  const inTenant = await db.workoutPlan.findFirst({ where: { id: planId }, select: { id: true } });
  if (!inTenant) throw new ApiError("not_found", "Plan not found");
  const row = await db.workoutPlan.findFirst({ where: { id: planId, ...planViewWhere(p) }, include: planInclude });
  if (!row) throw new ApiError("forbidden", "This plan is outside your own view");
  return planDto(row);
}

/**
 * PUT /workout-plans/{id} (updateWorkoutPlan). Full replace in one transaction. Items sent with
 * the `id` of a live item are updated in place (their logs stay attached); live items not sent
 * are archived when they have workout logs, otherwise removed. Bumps `version`, 409 when
 * `expectedVersion` is stale, writes `plan_updated` for every member with an active assignment.
 */
export async function updateWorkoutPlan(db: TenantClient, p: Principal, planId: string, body: unknown) {
  const input = parsePlanInput(body, true);
  await assertCanEditPlan(db, p, planId);
  await assertExercisesExist(db, input);

  const current = await db.workoutPlan.findFirst({ where: { id: planId }, select: { status: true, version: true } });
  if (!current) throw new ApiError("not_found", "Plan not found");
  if (current.status === "ARCHIVED") throw new ApiError("conflict", "An archived plan cannot be edited");
  if (current.version !== input.expectedVersion) {
    throw new ApiError("conflict", "The plan changed since you opened it; reload and try again");
  }

  await db.$transaction(async (raw) => {
    const tx = raw as unknown as TenantClient;
    const bumped = await tx.workoutPlan.updateMany({
      where: { id: planId, version: input.expectedVersion, status: { not: "ARCHIVED" } },
      data: {
        title: input.title,
        description: input.description,
        cadence: input.cadence.toUpperCase() as PlanCadence,
        sportSlug: input.sportSlug,
        status: input.status.toUpperCase() as PlanStatus,
        version: { increment: 1 },
      },
    });
    if (bumped.count === 0) throw new ApiError("conflict", "The plan changed since you opened it; reload and try again");

    const existingDays = await tx.workoutPlanDay.findMany({
      where: { planId },
      include: { items: { select: { id: true, archivedAt: true } } },
    });
    const live = new Map<string, string>(); // live item id -> day id
    for (const d of existingDays) for (const it of d.items) if (!it.archivedAt) live.set(it.id, d.id);
    const dayByIndex = new Map(existingDays.map((d) => [d.dayIndex, d]));

    // Upsert the days first so kept items can stay on their day.
    const dayIdByIndex = new Map<number, string>();
    for (const d of input.days) {
      const have = dayByIndex.get(d.dayIndex);
      if (have) {
        await tx.workoutPlanDay.update({ where: { id: have.id }, data: { title: d.title, notes: d.notes } });
        dayIdByIndex.set(d.dayIndex, have.id);
      } else {
        const made = await tx.workoutPlanDay.create({
          data: { planId, dayIndex: d.dayIndex, title: d.title, notes: d.notes } as never,
          select: { id: true },
        });
        dayIdByIndex.set(d.dayIndex, made.id);
      }
    }

    const kept = new Set<string>();
    for (const d of input.days) {
      const dayId = dayIdByIndex.get(d.dayIndex)!;
      for (const it of d.items) {
        const data = {
          exerciseId: it.exerciseId,
          position: it.position,
          sets: it.sets,
          reps: it.reps,
          durationSeconds: it.durationSeconds,
          restSeconds: it.restSeconds,
          supersetGroup: it.supersetGroup,
          rounds: it.rounds,
          targetWeightKg: it.targetWeightKg,
          targetDistanceMeters: it.targetDistanceMeters,
          notes: it.notes,
        };
        if (it.id && live.get(it.id) === dayId && !kept.has(it.id)) {
          kept.add(it.id);
          await tx.workoutPlanItem.update({ where: { id: it.id }, data });
        } else {
          await tx.workoutPlanItem.create({ data: { dayId, ...data } as never });
        }
      }
    }

    const dropped = [...live.keys()].filter((id) => !kept.has(id));
    if (dropped.length > 0) {
      const withLogs = new Set(
        (await tx.workoutLog.findMany({ where: { planItemId: { in: dropped } }, select: { planItemId: true }, distinct: ["planItemId"] })).map(
          (l) => l.planItemId,
        ),
      );
      const toArchive = dropped.filter((id) => withLogs.has(id));
      const toDelete = dropped.filter((id) => !withLogs.has(id));
      if (toArchive.length) await tx.workoutPlanItem.updateMany({ where: { id: { in: toArchive } }, data: { archivedAt: new Date() } });
      if (toDelete.length) await tx.workoutPlanItem.deleteMany({ where: { id: { in: toDelete } } });
    }

    // Days that are no longer sent and have nothing left are removed (days with archived items stay for history).
    const sent = new Set(input.days.map((d) => d.dayIndex));
    for (const d of existingDays) {
      if (sent.has(d.dayIndex)) continue;
      const remaining = await tx.workoutPlanItem.count({ where: { dayId: d.id } });
      if (remaining === 0) await tx.workoutPlanDay.delete({ where: { id: d.id } });
    }

    const version = input.expectedVersion! + 1;
    const assignees = await tx.planAssignment.findMany({
      where: { planId, status: { in: ["ACTIVE", "PAUSED"] } },
      select: { memberId: true, status: true },
    });
    await tx.planAssignment.updateMany({ where: { planId, status: { in: ["ACTIVE", "PAUSED"] } }, data: { planVersion: version } });
    await recordMemberUpdates(tx, {
      memberIds: assignees.filter((a) => a.status === "ACTIVE").map((a) => a.memberId),
      kind: "PLAN_UPDATED",
      entityType: "plan",
      entityId: planId,
      actorId: p.userId,
      params: { planTitle: input.title },
    });
  }, { timeout: 20_000, maxWait: 10_000 });

  return loadPlanDto(db, planId);
}

/** POST /workout-plans/{id}/archive (archiveWorkoutPlan). Ends active/paused assignments and notifies members. */
export async function archiveWorkoutPlan(db: TenantClient, p: Principal, planId: string) {
  await assertCanEditPlan(db, p, planId);
  const plan = await db.workoutPlan.findFirst({ where: { id: planId }, select: { status: true, title: true } });
  if (!plan) throw new ApiError("not_found", "Plan not found");
  if (plan.status === "ARCHIVED") return loadPlanDto(db, planId);

  const today = tenantDate(new Date());
  await db.$transaction(async (raw) => {
    const tx = raw as unknown as TenantClient;
    const flipped = await tx.workoutPlan.updateMany({
      where: { id: planId, status: { not: "ARCHIVED" } },
      data: { status: "ARCHIVED", archivedAt: new Date() },
    });
    if (flipped.count === 0) return; // someone archived it first
    const open = await tx.planAssignment.findMany({
      where: { planId, status: { in: ["ACTIVE", "PAUSED"] } },
      select: { id: true, memberId: true, startsOn: true, endsOn: true },
    });
    for (const a of open) {
      const startsOn = a.startsOn.toISOString().slice(0, 10);
      let end = today >= startsOn ? today : startsOn;
      if (a.endsOn && a.endsOn.toISOString().slice(0, 10) < end) end = a.endsOn.toISOString().slice(0, 10);
      await tx.planAssignment.update({ where: { id: a.id }, data: { status: "ENDED", endsOn: dateToDb(end) } });
      await recordMemberUpdates(tx, {
        memberIds: [a.memberId],
        kind: "PLAN_ENDED",
        entityType: "assignment",
        entityId: a.id,
        actorId: p.userId,
        params: { planTitle: plan.title },
      });
    }
  });
  return loadPlanDto(db, planId);
}
