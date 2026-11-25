import type { MessageKey, Params } from "../i18n";
import { groupIntoBlocks } from "../workouts/supersets";

/** View-model for the coach results screens. Pure: takes getPlanResults and getWorkoutPlan output. */

type T = (key: MessageKey, params?: Params) => string;

export type ResultSet = {
  id: string;
  setNumber: number;
  setType: string;
  weightKg: number | null;
  reps: number | null;
  seconds: number | null;
  meters: number | null;
  scoreMade: number | null;
  scoreOf: number | null;
  rating: number | null;
};
export type ResultNewBest = { metric: string; value: number; previous: number | null };
export type ResultLogItem = {
  logId: string;
  planItemId: string;
  exerciseId: string;
  exerciseName: string;
  metricType: string;
  status: string;
  note: string | null;
  actualSets: number | null;
  sets: ResultSet[];
  newBests: ResultNewBest[];
};
export type ResultDay = { date: string; items: ResultLogItem[] };
export type ResultAssignment = {
  assignmentId: string;
  memberId: string;
  memberName: string;
  status: string;
  startsOn: string;
  endsOn: string | null;
  note: string | null;
  itemsCompleted: number;
  itemsSkipped: number;
  daysLogged: number;
  setCount: number;
  newBestCount: number;
  days: ResultDay[];
};
/** Only the plan fields the view needs: planned sets and superset labels per item. */
export type PlanShape = { days: { items: { id: string; sets: number | null; rounds: number | null; supersetGroup: string | null }[] }[] };

export type SetLine = { key: string; label: string; value: string; warmup: boolean; typeLabel: string | null };
export type ItemView = {
  logId: string;
  name: string;
  skipped: boolean;
  note: string | null;
  sets: SetLine[];
  newBests: ResultNewBest[];
};
export type BlockView = { type: "single" | "superset"; label: string | null; rounds: number | null; items: ItemView[] };
export type DayView = { date: string; blocks: BlockView[]; setsDone: number; setsPlanned: number };
export type Badge = "completed" | "inProgress" | "notStarted";
export type AssignmentView = {
  assignmentId: string;
  memberId: string;
  memberName: string;
  badge: Badge;
  paused: boolean;
  ended: boolean;
  setsDone: number;
  setsPlanned: number;
  daysLogged: number;
  newBestCount: number;
  days: DayView[];
  /** Distinct member notes from logged items, newest first. */
  notes: string[];
};

const num = (n: number) => String(Math.round(n * 100) / 100);

/** One set as short readable text, by what the exercise measures. */
export function formatSet(s: ResultSet, t: T): string {
  if (s.scoreMade !== null && s.scoreOf !== null) return t("rs.set.value.score", { made: s.scoreMade, of: s.scoreOf });
  if (s.weightKg !== null && s.reps !== null) return t("rs.set.value.weightReps", { weight: num(s.weightKg), reps: s.reps });
  if (s.meters !== null && s.seconds !== null) return t("rs.set.value.distanceTime", { meters: s.meters, seconds: s.seconds });
  if (s.meters !== null) return t("rs.set.value.distance", { meters: s.meters });
  if (s.reps !== null) return t("rs.set.value.reps", { reps: s.reps });
  if (s.seconds !== null) return t("rs.set.value.seconds", { seconds: s.seconds });
  if (s.rating !== null) return t("rs.set.value.rating", { rating: s.rating });
  return t("rs.set.value.none");
}

/** A record value with its unit, by metric. */
export function formatBest(metric: string, value: number): string {
  const v = num(value);
  switch (metric) {
    case "most_reps":
      return `${v}`;
    case "longest_time":
    case "best_split":
      return `${v} s`;
    case "best_score":
      return `${v}%`;
    default:
      return `${v} kg`;
  }
}

const BEST_KEYS = new Set(["heaviest_weight", "one_rep_max", "best_set_volume", "session_volume", "most_reps", "longest_time", "best_split", "best_score"]);
export const bestKey = (metric: string): MessageKey => (BEST_KEYS.has(metric) ? (`we.best.${metric}` as MessageKey) : "we.best.heaviest_weight");

const SET_TYPE_LABEL: Record<string, MessageKey | undefined> = { warmup: "we.setType.WARMUP", drop: "we.setType.DROP", failure: "we.setType.FAILURE" };

export function buildAssignmentView(a: ResultAssignment, plan: PlanShape | null, t: T): AssignmentView {
  const planItems = new Map<string, { sets: number | null; rounds: number | null; supersetGroup: string | null }>();
  for (const d of plan?.days ?? []) for (const i of d.items) planItems.set(i.id, i);

  const days: DayView[] = a.days.map((d) => {
    const items = d.items.map((it) => {
      const meta = planItems.get(it.planItemId);
      const workSets = it.sets.filter((s) => s.setType !== "warmup").length;
      const done = it.sets.length > 0 ? workSets : (it.actualSets ?? 0);
      const planned = meta ? (meta.rounds ?? meta.sets ?? 0) : 0;
      return { it, meta, done, planned };
    });
    const grouped = groupIntoBlocks(items.map((x) => ({ ...x, supersetGroup: x.meta?.supersetGroup ?? null, rounds: x.meta?.rounds ?? null })));
    const blocks: BlockView[] = grouped.map((b) => ({
      type: b.type,
      label: b.label,
      rounds: b.rounds,
      items: b.items.map(({ it }) => ({
        logId: it.logId,
        name: it.exerciseName,
        skipped: it.status === "skipped",
        note: it.note,
        sets: it.sets.map((s, idx) => ({
          key: s.id,
          label: t("rs.set", { n: s.setNumber || idx + 1 }),
          value: formatSet(s, t),
          warmup: s.setType === "warmup",
          typeLabel: SET_TYPE_LABEL[s.setType] ? t(SET_TYPE_LABEL[s.setType]!) : null,
        })),
        newBests: it.newBests,
      })),
    }));
    return {
      date: d.date,
      blocks,
      setsDone: items.reduce((n, x) => n + x.done, 0),
      setsPlanned: items.reduce((n, x) => n + x.planned, 0),
    };
  });

  const all = a.days.flatMap((d) => d.items);
  const setsDone = days.reduce((n, d) => n + d.setsDone, 0);
  const setsPlanned = days.reduce((n, d) => n + d.setsPlanned, 0);
  const completed = all.length > 0 && all.every((i) => i.status === "completed");
  const notes = [...new Set(all.map((i) => i.note?.trim()).filter((n): n is string => Boolean(n)))];
  return {
    assignmentId: a.assignmentId,
    memberId: a.memberId,
    memberName: a.memberName,
    badge: all.length === 0 ? "notStarted" : completed ? "completed" : "inProgress",
    paused: a.status === "paused",
    ended: a.status === "ended",
    setsDone,
    setsPlanned,
    daysLogged: a.daysLogged,
    newBestCount: a.newBestCount,
    days,
    notes,
  };
}

/** "9 of 12 sets" when the plan has targets, "9 sets" otherwise. */
export function setsText(v: Pick<AssignmentView, "setsDone" | "setsPlanned">, t: T): string {
  return v.setsPlanned > 0 ? t("rs.sets", { done: Math.min(v.setsDone, v.setsPlanned), planned: v.setsPlanned }) : t("rs.setsOnly", { done: v.setsDone });
}

/** Members in name order, so the page never ranks anyone against anyone. */
export function sortByName<T extends { memberName: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.memberName.localeCompare(b.memberName, "en", { sensitivity: "base" }));
}

export const RESULT_RANGES = [7, 28, 90] as const;
export function parseRange(raw: unknown): (typeof RESULT_RANGES)[number] {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return (RESULT_RANGES as readonly number[]).includes(n) ? (n as (typeof RESULT_RANGES)[number]) : 28;
}
