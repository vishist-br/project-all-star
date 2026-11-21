import type { Exercise, Prisma } from "@prisma/client";
import { ApiError } from "../auth/errors";
import type { TenantClient } from "../tenant-scope";
import { pageArgs, toPage } from "./pagination";

export function exerciseSummary(e: Exercise) {
  return {
    id: e.id,
    name: e.name,
    sportSlug: e.sportSlug,
    equipment: e.equipment,
    primaryMuscles: e.primaryMuscles,
    needsTrainerReview: e.needsTrainerReview,
  };
}

export function exerciseDetail(e: Exercise) {
  return {
    ...exerciseSummary(e),
    category: e.category,
    level: e.level,
    secondaryMuscles: e.secondaryMuscles,
    instructions: e.instructions,
    licence: e.licence,
  };
}

/** GET /exercises (listExercises): the tenant's catalog, any role. */
export async function listExercises(db: TenantClient, params: URLSearchParams) {
  const { limit, args } = pageArgs(params);
  const and: Prisma.ExerciseWhereInput[] = [];
  const q = params.get("q")?.trim();
  if (q) and.push({ name: { contains: q, mode: "insensitive" } });
  const sport = params.get("sport");
  if (sport) and.push({ sportSlug: sport });
  const muscle = params.get("muscle");
  if (muscle) and.push({ OR: [{ primaryMuscles: { has: muscle.toLowerCase() } }, { primaryMuscles: { has: muscle } }] });
  const equipment = params.get("equipment");
  if (equipment) and.push({ equipment: { equals: equipment, mode: "insensitive" } });
  const level = params.get("level");
  if (level) and.push({ level: { equals: level, mode: "insensitive" } });
  const rows = await db.exercise.findMany({
    where: { AND: and },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    ...args,
  });
  const page = toPage(rows, limit);
  return { items: page.rows.map(exerciseSummary), nextCursor: page.nextCursor };
}

/** GET /exercises/{id} (getExercise). Another tenant's id is 404. */
export async function getExercise(db: TenantClient, id: string) {
  const e = await db.exercise.findFirst({ where: { id } });
  if (!e) throw new ApiError("not_found", "Exercise not found");
  return exerciseDetail(e);
}
