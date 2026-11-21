import type { Locale, MessageKey, Params } from "../i18n";
import { formatSeconds } from "./format";
import type { ItemStatus } from "./queue";

type T = (key: MessageKey, params?: Params) => string;

/** One workout item of the member on one day (the shape of getMemberSchedule's day items, plus the date). */
export type WorkoutItem = {
  date: string;
  assignmentId: string;
  planId: string;
  planTitle: string;
  planItemId: string;
  exerciseId: string;
  exerciseName: string;
  position: number;
  sets: number | null;
  reps: number | null;
  durationSeconds: number | null;
  restSeconds: number | null;
  notes: string | null;
  status: ItemStatus;
};

/** "3 sets × 10 reps", "1 min", "Rest 30 sec": the targets of an item as short readable parts. */
export function targetParts(
  item: Pick<WorkoutItem, "sets" | "reps" | "durationSeconds" | "restSeconds">,
  t: T,
  locale: Locale,
): string[] {
  const parts: string[] = [];
  if (item.sets && item.reps) parts.push(t("cu.target.setsReps", { sets: item.sets, reps: item.reps }));
  else if (item.sets) parts.push(t("cu.target.sets", { n: item.sets }));
  else if (item.reps) parts.push(t("cu.target.reps", { n: item.reps }));
  if (item.durationSeconds) {
    const d = formatSeconds(item.durationSeconds, locale);
    parts.push(item.sets ? t("cu.target.eachSet", { d }) : d);
  }
  if (item.restSeconds) parts.push(t("cu.target.rest", { d: formatSeconds(item.restSeconds, locale) }));
  return parts;
}

/** Items grouped by plan, keeping the order in which plans first appear. */
export function groupByPlan<T extends { planId: string; planTitle: string }>(items: readonly T[]): { planId: string; planTitle: string; items: T[] }[] {
  const out: { planId: string; planTitle: string; items: T[] }[] = [];
  for (const it of items) {
    let g = out.find((x) => x.planId === it.planId);
    if (!g) out.push((g = { planId: it.planId, planTitle: it.planTitle, items: [] }));
    g.items.push(it);
  }
  return out;
}

export function countByStatus(items: readonly Pick<WorkoutItem, "status">[]): { done: number; todo: number; skipped: number } {
  let done = 0;
  let skipped = 0;
  for (const i of items) {
    if (i.status === "completed") done += 1;
    else if (i.status === "skipped") skipped += 1;
  }
  return { done, skipped, todo: items.length - done - skipped };
}

type ScheduleDayItem = Omit<WorkoutItem, "date">;

/** The items of one schedule day as WorkoutItems (adds the date, keeps the API's order). */
export function toWorkoutItems(day: { date: string; items: ScheduleDayItem[] }): WorkoutItem[] {
  return day.items.map((i) => ({
    date: day.date,
    assignmentId: i.assignmentId,
    planId: i.planId,
    planTitle: i.planTitle,
    planItemId: i.planItemId,
    exerciseId: i.exerciseId,
    exerciseName: i.exerciseName,
    position: i.position,
    sets: i.sets,
    reps: i.reps,
    durationSeconds: i.durationSeconds,
    restSeconds: i.restSeconds,
    notes: i.notes,
    status: i.status,
  }));
}
