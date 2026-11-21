import type { TenantClient } from "../tenant-scope";

export type ExerciseFacets = { sports: string[]; muscles: string[]; equipments: string[] };

/** Filter choices for the exercise picker, taken from the tenant's own catalog. */
export async function loadExerciseFacets(db: TenantClient): Promise<ExerciseFacets> {
  const rows = await db.exercise.findMany({ select: { sportSlug: true, equipment: true, primaryMuscles: true } });
  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort();
  return {
    sports: uniq(rows.map((r) => r.sportSlug)),
    muscles: uniq(rows.flatMap((r) => r.primaryMuscles)),
    equipments: uniq(rows.map((r) => r.equipment)),
  };
}
