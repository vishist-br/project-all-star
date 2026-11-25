import { assertCanViewMember } from "../auth/access";
import type { Principal } from "../auth/principal";
import type { TenantClient } from "../tenant-scope";
import { MUSCLE_RANGES, RANGE_DAYS, aggregateMuscleVolume, type MuscleRange, type MuscleSet } from "../workouts/muscle-volume";
import { dateToDb } from "../workouts/validate";
import { enumParam, tenantDate } from "./pagination";

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * GET /members/{memberId}/muscle-volume (getMuscleVolume). Sets and total volume per primary muscle
 * of the gym exercises the member logged in the last 7 or 28 days (today included). Same visibility
 * as getMember. `hasGymData` is false when the member has never logged a gym set (non-gym members).
 */
export async function getMuscleVolume(db: TenantClient, p: Principal, memberId: string, params: URLSearchParams, now = new Date()) {
  await assertCanViewMember(db, p, memberId);
  const range = (enumParam(params, "range", MUSCLE_RANGES) ?? "7d") as MuscleRange;
  const days = RANGE_DAYS[range];
  const to = tenantDate(now);
  const from = addDays(to, 1 - days);
  const gymLog = { memberId, planItem: { exercise: { sportSlug: "gym" } } };
  const [rows, ever] = await Promise.all([
    db.workoutSet.findMany({
      where: { log: { ...gymLog, scheduledFor: { gte: dateToDb(from), lte: dateToDb(to) } } },
      select: { setType: true, weightKg: true, reps: true, log: { select: { planItem: { select: { exercise: { select: { primaryMuscles: true } } } } } } },
      take: 5000,
    }),
    db.workoutSet.findFirst({ where: { log: gymLog }, select: { id: true } }),
  ]);
  const sets: MuscleSet[] = rows.map((r) => ({
    setType: r.setType,
    weightKg: r.weightKg === null ? null : Number(r.weightKg.toString()),
    reps: r.reps,
    primaryMuscles: r.log.planItem.exercise.primaryMuscles,
  }));
  const agg = aggregateMuscleVolume(sets, days / 7);
  return { memberId, range, from, to, weeks: days / 7, hasGymData: Boolean(ever), ...agg };
}
