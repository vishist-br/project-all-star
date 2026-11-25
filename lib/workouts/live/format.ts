import { formatSeconds } from "../../customer/format";
import type { Locale, MessageKey, Params } from "../../i18n";
import type { LiveItem, MetricType, SavedSet } from "./model";

type T = (key: MessageKey, params?: Params) => string;

const trim = (n: number) => String(Math.round(n * 100) / 100);

/** One saved set as short text: "40 kg × 8", "45 s", "50 m in 61 s", "12/20", "3/4". */
export function formatSet(metric: MetricType, s: SavedSet, t: T): string | null {
  switch (metric) {
    case "WEIGHT_REPS": {
      if (s.weightKg !== null && s.reps !== null) return `${t("lw.unit.kg", { n: trim(s.weightKg) })} × ${s.reps}`;
      if (s.reps !== null) return t("lw.unit.reps", { n: s.reps });
      if (s.weightKg !== null) return t("lw.unit.kg", { n: trim(s.weightKg) });
      return null;
    }
    case "REPS":
      return s.reps === null ? null : t("lw.unit.reps", { n: s.reps });
    case "TIME":
      return s.seconds === null ? null : t("lw.unit.sec", { n: s.seconds });
    case "DISTANCE_TIME":
      if (s.meters === null) return null;
      return s.seconds === null ? t("lw.sum.metres", { n: s.meters }) : `${t("lw.sum.metres", { n: s.meters })}, ${t("lw.unit.sec", { n: s.seconds })}`;
    case "SCORE":
      return s.scoreMade === null || s.scoreOf === null ? null : `${s.scoreMade}/${s.scoreOf}`;
    case "CHECKLIST":
      return s.rating === null ? null : `${s.rating}/4`;
  }
}

/** The first few sets of the member's last session, joined: "40 kg × 8 · 40 kg × 8 · 45 kg × 6". null when there is none. */
export function formatLast(metric: MetricType, sets: readonly SavedSet[], t: T, max = 3): string | null {
  const parts = sets
    .map((s) => formatSet(metric, s, t))
    .filter((x): x is string => x !== null)
    .slice(0, max);
  return parts.length === 0 ? null : parts.join(" · ");
}

/** The plan's targets of an item as short parts. A superset item has rounds, not sets. */
export function formatTargets(item: LiveItem, inSuperset: boolean, t: T, locale: Locale): string[] {
  const parts: string[] = [];
  const sets = inSuperset ? null : item.sets;
  if (sets && item.reps && item.metricType !== "SCORE") parts.push(t("cu.target.setsReps", { sets, reps: item.reps }));
  else if (sets) parts.push(t("cu.target.sets", { n: sets }));
  else if (item.reps && item.metricType !== "SCORE") parts.push(t("cu.target.reps", { n: item.reps }));
  if (item.metricType === "SCORE" && item.reps) parts.push(`${t("pb.target.attempts")}: ${item.reps}`);
  if (item.targetWeightKg) parts.push(t("lw.unit.kg", { n: trim(item.targetWeightKg) }));
  if (item.targetDistanceMeters) parts.push(t("lw.sum.metres", { n: item.targetDistanceMeters }));
  if (item.durationSeconds) {
    const d = formatSeconds(item.durationSeconds, locale);
    parts.push(sets ? t("cu.target.eachSet", { d }) : d);
  }
  return parts;
}

/** A record value with its unit, by the engine's metric name (we.best.*). */
export function formatBestValue(metric: string, value: number, t: T): string {
  switch (metric) {
    case "heaviest_weight":
    case "one_rep_max":
    case "best_set_volume":
    case "session_volume":
      return t("lw.unit.kg", { n: trim(value) });
    case "most_reps":
      return t("lw.unit.reps", { n: Math.round(value) });
    case "longest_time":
      return t("lw.unit.sec", { n: Math.round(value) });
    case "best_split":
      return t("lw.unit.split", { n: trim(value) });
    case "best_score":
      return t("lw.unit.percent", { n: trim(value) });
    default:
      return trim(value);
  }
}

const BEST_KEYS = ["heaviest_weight", "one_rep_max", "best_set_volume", "session_volume", "most_reps", "longest_time", "best_split", "best_score"] as const;
export const isBestMetric = (m: string): m is (typeof BEST_KEYS)[number] => (BEST_KEYS as readonly string[]).includes(m);
