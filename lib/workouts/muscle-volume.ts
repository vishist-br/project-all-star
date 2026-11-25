/**
 * Sets and volume per primary muscle from logged sets. Pure: no database, no clock.
 *
 * Conventions (documented in docs/api/openapi.yaml, getMuscleVolume):
 *  - Warm-up sets never count. A set counts when it has reps (bodyweight sets count as sets with no volume).
 *  - A set counts once for each primary muscle of its exercise; volume is weight x reps (kg).
 *  - `weeks` is the length of the window in weeks (1 for 7 days, 4 for 28 days) and gives `setsPerWeek`.
 *  - Muscles are sorted by sets (most first), then by name, so the list is stable.
 */
export const MUSCLE_RANGES = ["7d", "28d"] as const;
export type MuscleRange = (typeof MUSCLE_RANGES)[number];
export const RANGE_DAYS: Record<MuscleRange, number> = { "7d": 7, "28d": 28 };

export type MuscleSet = {
  setType: "NORMAL" | "WARMUP" | "DROP" | "FAILURE";
  weightKg: number | null;
  reps: number | null;
  primaryMuscles: readonly string[];
};

export type MuscleRow = { muscle: string; sets: number; volumeKg: number; setsPerWeek: number };

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

export function aggregateMuscleVolume(sets: readonly MuscleSet[], weeks: number): { muscles: MuscleRow[]; totalSets: number; totalVolumeKg: number } {
  const per = new Map<string, { sets: number; volume: number }>();
  let totalSets = 0;
  let totalVolume = 0;
  for (const s of sets) {
    if (s.setType === "WARMUP" || !s.reps || s.reps < 1) continue;
    const muscles = [...new Set(s.primaryMuscles.map((m) => m.trim().toLowerCase()).filter(Boolean))];
    if (muscles.length === 0) continue;
    const volume = s.weightKg && s.weightKg > 0 ? s.weightKg * s.reps : 0;
    totalSets += 1;
    totalVolume += volume;
    for (const m of muscles) {
      const cur = per.get(m) ?? { sets: 0, volume: 0 };
      cur.sets += 1;
      cur.volume += volume;
      per.set(m, cur);
    }
  }
  const w = weeks > 0 ? weeks : 1;
  const muscles = [...per.entries()]
    .map(([muscle, v]) => ({ muscle, sets: v.sets, volumeKg: round2(v.volume), setsPerWeek: round1(v.sets / w) }))
    .sort((a, b) => b.sets - a.sets || a.muscle.localeCompare(b.muscle));
  return { muscles, totalSets, totalVolumeKg: round2(totalVolume) };
}
