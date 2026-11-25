import type { SetType } from "@prisma/client";
import { assertCanViewMember } from "../auth/access";
import type { Principal } from "../auth/principal";
import { loadScheduledEntries } from "../api/schedule";
import type { TenantClient } from "../tenant-scope";
import { asMetric, type LiveItem, type SavedSet } from "../workouts/live/model";
import { dateToDb } from "../workouts/validate";

export type LiveWorkoutData = {
  memberId: string;
  date: string;
  items: LiveItem[];
  /** Sets already stored for today, by `assignmentId:planItemId`. */
  saved: Record<string, SavedSet[]>;
  /** The member's most recent earlier session of each exercise (work sets), by exercise id. */
  last: Record<string, SavedSet[]>;
  /** Item-level skipped today (they are left out of the live screen). */
  skippedCount: number;
};

type Row = {
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
};

const toSaved = (r: Row): SavedSet => ({
  clientId: r.clientId,
  setNumber: r.setNumber,
  setType: r.setType.toLowerCase() as SavedSet["setType"],
  weightKg: r.weightKg === null ? null : Number(r.weightKg.toString()),
  reps: r.reps,
  seconds: r.seconds,
  meters: r.meters,
  scoreMade: r.scoreMade,
  scoreOf: r.scoreOf,
  rating: r.rating,
});

/**
 * Everything the live workout screen needs for one member and day, read through the same functions
 * and tenant-scoped client as the other customer screens: today's items from the schedule (with
 * supersets, rounds and targets), the sets already saved today, and the last session per exercise.
 */
export async function loadLiveWorkout(db: TenantClient, principal: Principal, memberId: string, today: string): Promise<LiveWorkoutData> {
  await assertCanViewMember(db, principal, memberId);
  // Only today's workout entries are needed: no sessions, bookings or holiday lookups (STAR-102).
  const entries = (await loadScheduledEntries(db, [memberId], today, today)).sort(
    (a, b) => a.planTitle.localeCompare(b.planTitle) || a.item.position - b.item.position,
  );
  const all: LiveItem[] = entries.map((e) => ({
    assignmentId: e.assignmentId,
    planId: e.planId,
    planTitle: e.planTitle,
    planItemId: e.item.id,
    exerciseId: e.item.exerciseId,
    exerciseName: e.item.exerciseName,
    metricType: asMetric(e.item.metricType),
    position: e.item.position,
    sets: e.item.sets,
    reps: e.item.reps,
    durationSeconds: e.item.durationSeconds,
    restSeconds: e.item.restSeconds,
    targetWeightKg: e.item.targetWeightKg ?? null,
    targetDistanceMeters: e.item.targetDistanceMeters ?? null,
    supersetGroup: e.item.supersetGroup ?? null,
    rounds: e.item.rounds ?? null,
    notes: e.item.notes,
    status: e.log?.status ?? "pending",
  }));
  const items = all.filter((i) => i.status !== "skipped");

  const saved: Record<string, SavedSet[]> = {};
  const last: Record<string, SavedSet[]> = {};
  if (items.length > 0) {
    const exerciseIds = [...new Set(items.map((i) => i.exerciseId))];
    const [todaySets, earlier] = await Promise.all([
      db.workoutSet.findMany({
        where: { log: { memberId, scheduledFor: dateToDb(today) } },
        include: { log: { select: { assignmentId: true, planItemId: true } } },
        orderBy: [{ setNumber: "asc" }, { completedAt: "asc" }],
      }),
      db.workoutSet.findMany({
        where: { log: { memberId, scheduledFor: { lt: dateToDb(today) }, planItem: { exerciseId: { in: exerciseIds } } }, setType: { not: "WARMUP" } },
        include: { log: { select: { id: true, scheduledFor: true, planItem: { select: { exerciseId: true } } } } },
        orderBy: [{ log: { scheduledFor: "desc" } }, { setNumber: "asc" }],
        take: 400,
      }),
    ]);
    for (const r of todaySets) {
      const key = `${r.log.assignmentId}:${r.log.planItemId}`;
      (saved[key] ??= []).push(toSaved(r as unknown as Row));
    }
    const lastLog = new Map<string, string>();
    for (const r of earlier) {
      const ex = r.log.planItem.exerciseId;
      if (!lastLog.has(ex)) lastLog.set(ex, r.log.id);
      if (lastLog.get(ex) === r.log.id) (last[ex] ??= []).push(toSaved(r as unknown as Row));
    }
  }
  return { memberId, date: today, items, saved, last, skippedCount: all.length - items.length };
}
