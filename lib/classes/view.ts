import type { MessageKey, Params } from "../i18n";
import type { RowView } from "../offline/rollcall";

type T = (key: MessageKey, params?: Params) => string;

/** Who gets what when the coach finishes the class. Members told in advance are excused rows, or unmarked rows with a declaration (finishing marks them excused). */
export function finishAudience(rows: readonly Pick<RowView, "attendance" | "tappable" | "declaredReason">[]) {
  let present = 0;
  let absent = 0;
  let told = 0;
  for (const r of rows) {
    if (!r.tappable) continue;
    if (r.attendance === "present") present += 1;
    else if (r.attendance === "absent") absent += 1;
    else if (r.attendance === "excused" || r.declaredReason) told += 1;
  }
  return { present, absent, told };
}

export type When = { kind: "now" | "today" | "yesterday" } | { kind: "date"; iso: string };

const DAY = 24 * 60 * 60 * 1000;
const IST = 330 * 60 * 1000;
const istDay = (ms: number) => Math.floor((ms + IST) / DAY);

/** "just now" for the first 30 minutes after the summary was shared, then today, yesterday, or a date. */
export function relativeWhen(publishedIso: string, now: Date): When {
  const at = new Date(publishedIso).getTime();
  const diff = now.getTime() - at;
  if (diff < 30 * 60 * 1000) return { kind: "now" };
  const days = istDay(now.getTime()) - istDay(at);
  if (days <= 0) return { kind: "today" };
  if (days === 1) return { kind: "yesterday" };
  return { kind: "date", iso: publishedIso };
}

export function whenText(w: When, t: T, formatDate: (iso: string) => string): string {
  if (w.kind === "date") return formatDate(w.iso);
  return t(`csm.when.${w.kind}` as MessageKey);
}

type Item = {
  id: string;
  exerciseName: string;
  sets: number | null;
  reps: number | null;
  durationSeconds: number | null;
  targetDistanceMeters: number | null;
};
export type WorkoutBlock = { type: "single" | "superset"; label: string | null; rounds: number | null; items: Item[] };
export type WorkoutLike = { planTitle: string; dayTitle: string | null; blocks: WorkoutBlock[] };

/** "3 sets of 10", "45 sec", "50 m": the target of one exercise in a class workout. Empty when none. */
export function targetText(i: Item, t: T): string {
  if (i.sets && i.reps) return t("csm.workout.line.setsReps", { sets: i.sets, reps: i.reps });
  if (i.reps) return t("csm.workout.line.reps", { reps: i.reps });
  if (i.durationSeconds) return t("csm.workout.line.time", { seconds: i.durationSeconds });
  if (i.targetDistanceMeters) return t("csm.workout.line.distance", { meters: i.targetDistanceMeters });
  if (i.sets) return t("csm.workout.line.sets", { sets: i.sets });
  return "";
}

export type WorkoutRowView = { id: string; name: string; target: string };
export type WorkoutBlockView = { superset: boolean; heading: string | null; rows: WorkoutRowView[] };

/** Class workout as blocks of rows. A superset gets a heading; a single exercise has none. */
export function workoutBlocks(w: WorkoutLike | null, t: T): WorkoutBlockView[] {
  if (!w) return [];
  return w.blocks.map((b) => ({
    superset: b.type === "superset",
    heading:
      b.type === "superset"
        ? [t("csm.superset", { label: b.label ?? "" }), b.rounds ? t("csm.rounds", { n: b.rounds }) : null].filter(Boolean).join(" · ")
        : null,
    rows: b.items.map((i) => ({ id: i.id, name: i.exerciseName, target: targetText(i, t) })),
  }));
}

export type BeltLike = {
  levelName: string;
  doneCount: number;
  totalCount: number;
  percent: number;
};

/** The next belt's skill checklist as a single progress line, or null when the member has no checklist. */
export function nextBelt(
  progress: { checklists: { isNextLevel: boolean; levelName: string | null; title: string; doneCount: number; totalCount: number; percent: number }[] } | null,
): BeltLike | null {
  const c = progress?.checklists.find((x) => x.isNextLevel && x.totalCount > 0);
  if (!c) return null;
  return { levelName: c.levelName ?? c.title, doneCount: c.doneCount, totalCount: c.totalCount, percent: c.percent };
}

/** Public share URL path for a token, so the client can show the link the server made. */
export function isShareUrl(url: string): boolean {
  return /\/share\/class\/[A-Za-z0-9_-]{16,}$/.test(url);
}
