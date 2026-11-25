import type { MessageKey } from "../i18n";

/**
 * View-model for the exercise progress screens: which metrics a chart can show per metric type,
 * the series behind each chip, the headline tiles and the "new best" mark. Pure functions over the
 * `getExerciseHistory` response, so they are unit-tested without a database.
 */

export type MetricType = "WEIGHT_REPS" | "REPS" | "TIME" | "DISTANCE_TIME" | "SCORE" | "CHECKLIST";
export type Unit = "kg" | "reps" | "sec" | "split" | "m" | "pct" | "points" | "rating";
export type MetricId =
  | "heaviestWeight"
  | "oneRepMax"
  | "bestSetVolume"
  | "sessionVolume"
  | "totalReps"
  | "bestReps"
  | "bestTime"
  | "totalTime"
  | "bestSplit"
  | "distance"
  | "bestScore"
  | "scoreMade"
  | "rating";

export const RANGES = ["3m", "1y", "all"] as const;
export type Range = (typeof RANGES)[number];
export const DEFAULT_RANGE: Range = "3m";

export function parseRange(raw: unknown): Range {
  return typeof raw === "string" && (RANGES as readonly string[]).includes(raw) ? (raw as Range) : DEFAULT_RANGE;
}

export type Point = { date: string; value: number };

export type HistorySet = {
  setType: string;
  weightKg: number | null;
  reps: number | null;
  seconds: number | null;
  meters: number | null;
  scoreMade: number | null;
  scoreOf: number | null;
  rating: number | null;
  setNumber?: number;
};
export type HistoryLike = {
  metricType: string;
  from: string | null;
  sessions: { logId: string; date: string; status?: string; sets: HistorySet[] }[];
  series: Record<"heaviestWeight" | "oneRepMax" | "bestSetVolume" | "sessionVolume" | "totalReps" | "bestTime" | "bestSplit" | "bestScore", Point[]>;
  records: {
    heaviestWeight: Point | null;
    oneRepMax: Point | null;
    mostReps: Point | null;
    longestTime: Point | null;
    bestSplit: Point | null;
    bestScore: Point | null;
    weightAtReps: { reps: number; weightKg: number; date: string }[];
  };
  newBests: { logId: string; date: string; metric: string; value: number; previous: number }[];
};

export type MetricDef = {
  id: MetricId;
  label: MessageKey;
  unit: Unit;
  /** A lower number is the better one (swim split). */
  lowerIsBetter?: boolean;
  /** The `newBests[].metric` name that marks a record on this chip, when the API reports one. */
  newBest?: string;
};

const DEFS: Record<MetricId, MetricDef> = {
  heaviestWeight: { id: "heaviestWeight", label: "xp.m.heaviestWeight", unit: "kg", newBest: "heaviest_weight" },
  oneRepMax: { id: "oneRepMax", label: "xp.m.oneRepMax", unit: "kg", newBest: "one_rep_max" },
  bestSetVolume: { id: "bestSetVolume", label: "xp.m.bestSetVolume", unit: "kg", newBest: "best_set_volume" },
  sessionVolume: { id: "sessionVolume", label: "xp.m.sessionVolume", unit: "kg", newBest: "session_volume" },
  totalReps: { id: "totalReps", label: "xp.m.totalReps", unit: "reps" },
  bestReps: { id: "bestReps", label: "xp.m.bestReps", unit: "reps", newBest: "most_reps" },
  bestTime: { id: "bestTime", label: "xp.m.bestTime", unit: "sec", newBest: "longest_time" },
  totalTime: { id: "totalTime", label: "xp.m.totalTime", unit: "sec" },
  bestSplit: { id: "bestSplit", label: "xp.m.bestSplit", unit: "split", lowerIsBetter: true, newBest: "best_split" },
  distance: { id: "distance", label: "xp.m.distance", unit: "m" },
  bestScore: { id: "bestScore", label: "xp.m.bestScore", unit: "pct", newBest: "best_score" },
  scoreMade: { id: "scoreMade", label: "xp.m.scoreMade", unit: "points" },
  rating: { id: "rating", label: "xp.m.rating", unit: "rating" },
};

const BY_TYPE: Record<MetricType, MetricId[]> = {
  WEIGHT_REPS: ["heaviestWeight", "oneRepMax", "bestSetVolume", "sessionVolume", "totalReps"],
  TIME: ["bestTime", "totalTime"],
  DISTANCE_TIME: ["bestSplit", "distance"],
  SCORE: ["bestScore", "scoreMade"],
  REPS: ["bestReps", "totalReps"],
  CHECKLIST: ["rating"],
};

export function asMetricType(raw: string): MetricType {
  return raw in BY_TYPE ? (raw as MetricType) : "WEIGHT_REPS";
}

const worksets = (sets: HistorySet[]) => sets.filter((s) => s.setType.toLowerCase() !== "warmup");
const sum = (xs: (number | null)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);
const maxOr = (xs: (number | null)[]): number | null => {
  const n = xs.filter((x): x is number => x !== null);
  return n.length ? Math.max(...n) : null;
};

function derived(h: HistoryLike, id: MetricId): Point[] {
  const out: Point[] = [];
  for (const s of [...h.sessions].reverse()) {
    const w = worksets(s.sets);
    let v: number | null = null;
    if (id === "bestReps") v = maxOr(w.map((x) => x.reps));
    else if (id === "totalTime") v = w.some((x) => x.seconds !== null) ? sum(w.map((x) => x.seconds)) : null;
    else if (id === "bestTime") v = maxOr(w.map((x) => x.seconds));
    else if (id === "distance") v = w.some((x) => x.meters !== null) ? sum(w.map((x) => x.meters)) : null;
    else if (id === "scoreMade") v = maxOr(w.map((x) => x.scoreMade));
    else if (id === "rating") v = maxOr(w.map((x) => x.rating));
    if (v !== null && v > 0) out.push({ date: s.date, value: v });
  }
  return out;
}

/** Oldest first, only inside the selected range, one point per session. */
export function seriesFor(h: HistoryLike, id: MetricId): Point[] {
  const api = (h.series as Record<string, Point[] | undefined>)[id];
  const pts = api && api.length > 0 ? api : derived(h, id);
  return h.from ? pts.filter((p) => p.date >= h.from!) : pts;
}

/**
 * The metric type the screen follows. A gym "plank" is stored as WEIGHT_REPS but only has seconds, so
 * when a weight-and-reps exercise has no weight or reps in range but has times, show it as TIME.
 */
export function effectiveMetricType(h: HistoryLike): MetricType {
  const type = asMetricType(h.metricType);
  if (type !== "WEIGHT_REPS") return type;
  const hasWeightData = BY_TYPE.WEIGHT_REPS.some((id) => seriesFor(h, id).length > 0) || h.records.heaviestWeight !== null;
  if (!hasWeightData && seriesFor(h, "bestTime").length > 0) return "TIME";
  return type;
}

/** Chip list for the chart, in display order. */
export function metricsFor(h: HistoryLike): MetricDef[] {
  return BY_TYPE[effectiveMetricType(h)].map((id) => DEFS[id]);
}

export function metricDef(id: MetricId): MetricDef {
  return DEFS[id];
}

/** Pick the requested chip when it belongs to this exercise, else the first one. */
export function selectMetric(h: HistoryLike, raw: unknown): MetricDef {
  const list = metricsFor(h);
  return list.find((m) => m.id === raw) ?? list[0]!;
}

export type ChartModel = {
  points: Point[];
  latest: Point | null;
  first: Point | null;
  min: number;
  max: number;
  /** Date of the newest record on this metric in range (the "New best" mark), if any. */
  newBestDate: string | null;
};

export function chartModel(h: HistoryLike, def: MetricDef): ChartModel {
  const points = seriesFor(h, def.id);
  const values = points.map((p) => p.value);
  const mark = def.newBest ? h.newBests.filter((n) => n.metric === def.newBest).map((n) => n.date).sort().pop() ?? null : null;
  return {
    points,
    latest: points[points.length - 1] ?? null,
    first: points[0] ?? null,
    min: values.length ? Math.min(...values) : 0,
    max: values.length ? Math.max(...values) : 0,
    newBestDate: mark && points.some((p) => p.date === mark) ? mark : null,
  };
}

export type Tile = { id: string; label: MessageKey; unit: Unit | "count"; value: number | null; date?: string | null };

/** Three headline tiles that adapt to the metric type. Records cover all history; totals follow the range. */
export function statTiles(h: HistoryLike): Tile[] {
  const type = effectiveMetricType(h);
  const w = h.sessions.flatMap((s) => worksets(s.sets));
  const sessions: Tile = { id: "sessions", label: "xp.tile.sessions", unit: "count", value: h.sessions.length };
  const rec = (r: Point | null) => ({ value: r?.value ?? null, date: r?.date ?? null });
  switch (type) {
    case "WEIGHT_REPS":
      return [
        { id: "best", label: "xp.tile.bestWeight", unit: "kg", ...rec(h.records.heaviestWeight) },
        { id: "max", label: "xp.tile.estMax", unit: "kg", ...rec(h.records.oneRepMax) },
        sessions,
      ];
    case "TIME":
      return [
        { id: "best", label: "xp.tile.bestTime", unit: "sec", ...rec(h.records.longestTime ?? bestOf(derived(h, "bestTime"), false)) },
        { id: "total", label: "xp.tile.totalTime", unit: "sec", value: w.some((x) => x.seconds !== null) ? sum(w.map((x) => x.seconds)) : null },
        sessions,
      ];
    case "DISTANCE_TIME":
      return [
        { id: "best", label: "xp.tile.bestSplit", unit: "split", ...rec(h.records.bestSplit) },
        { id: "total", label: "xp.tile.distance", unit: "m", value: w.some((x) => x.meters !== null) ? sum(w.map((x) => x.meters)) : null },
        sessions,
      ];
    case "SCORE":
      return [
        { id: "best", label: "xp.tile.accuracy", unit: "pct", ...rec(h.records.bestScore) },
        { id: "total", label: "xp.tile.bestScore", unit: "points", value: maxOr(w.map((x) => x.scoreMade)) },
        sessions,
      ];
    case "CHECKLIST":
      return [
        { id: "best", label: "xp.tile.bestRating", unit: "rating", value: maxOr(w.map((x) => x.rating)) },
        { id: "total", label: "xp.tile.latestRating", unit: "rating", value: lastRating(h) },
        sessions,
      ];
    default:
      return [
        { id: "best", label: "xp.tile.bestReps", unit: "reps", ...rec(h.records.mostReps) },
        { id: "total", label: "xp.tile.totalReps", unit: "reps", value: w.some((x) => x.reps !== null) ? sum(w.map((x) => x.reps)) : null },
        sessions,
      ];
  }
}

function bestOf(points: Point[], lower: boolean): Point | null {
  if (!points.length) return null;
  return points.reduce((a, b) => ((lower ? b.value < a.value : b.value > a.value) ? b : a));
}

function lastRating(h: HistoryLike): number | null {
  for (const s of h.sessions) {
    const r = maxOr(worksets(s.sets).map((x) => x.rating));
    if (r !== null) return r;
  }
  return null;
}

/** True when nothing was logged in the selected range. */
export function isEmpty(h: HistoryLike): boolean {
  return h.sessions.length === 0;
}

/** Records table rows, only for weight-and-reps exercises. */
export function repRecords(h: HistoryLike) {
  return effectiveMetricType(h) === "WEIGHT_REPS" ? h.records.weightAtReps : [];
}

/** "none": nothing logged ever. "range": logged before, but not in the selected range. null: there is data to show. */
export function emptyKind(h: HistoryLike): "none" | "range" | null {
  if (h.sessions.length > 0) return null;
  const r = h.records;
  const any = [r.heaviestWeight, r.oneRepMax, r.mostReps, r.longestTime, r.bestSplit, r.bestScore].some((x) => x !== null) || r.weightAtReps.length > 0;
  return any ? "range" : "none";
}

/** The metric the overview sparkline follows for an exercise. */
export function primaryMetric(h: HistoryLike): MetricDef {
  return metricsFor(h)[0]!;
}

/** One row of the "Exercises" overview: the primary metric, its latest value and the last few points for a sparkline. */
export function overviewOf(h: HistoryLike, maxPoints = 12) {
  const metric = primaryMetric(h);
  const points = seriesFor(h, metric.id);
  return { metric, latest: points[points.length - 1] ?? null, spark: points.slice(-maxPoints).map((p) => p.value), sessions: h.sessions.length };
}

// ---- Display ---------------------------------------------------------------------------------

type Fmt = { t: (key: MessageKey, params?: Record<string, string | number>) => string; locale: string };
const TAG: Record<string, string> = { en: "en-IN", hi: "hi-IN", kn: "kn-IN" };

export function num(n: number, locale: string, digits = 1): string {
  return new Intl.NumberFormat(TAG[locale] ?? "en-IN", { maximumFractionDigits: digits }).format(n);
}

function minSec(seconds: number, f: Fmt): string {
  const s = Math.round(seconds);
  if (s < 60) return f.t("xp.fmt.sec", { n: num(s, f.locale, 0) });
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest === 0 ? f.t("xp.fmt.min", { n: num(m, f.locale, 0) }) : f.t("xp.fmt.minSec", { m: num(m, f.locale, 0), s: num(rest, f.locale, 0) });
}

/** A value with its unit, in the viewer's language. */
export function formatValue(value: number | null, unit: Unit | "count", f: Fmt): string {
  if (value === null) return f.t("xp.noValue");
  switch (unit) {
    case "kg":
      return f.t("xp.fmt.kg", { n: num(value, f.locale) });
    case "reps":
      return f.t("xp.fmt.reps", { n: num(value, f.locale, 0) });
    case "sec":
      return minSec(value, f);
    case "split":
      return f.t("xp.fmt.split", { time: minSec(value, f) });
    case "m":
      return f.t("xp.fmt.m", { n: num(value, f.locale, 0) });
    case "pct":
      return f.t("xp.fmt.pct", { n: num(value, f.locale, 0) });
    case "rating":
      return f.t(`sk.rating.${Math.min(4, Math.max(1, Math.round(value)))}` as MessageKey);
    default:
      return num(value, f.locale, 0);
  }
}

/** Short axis number without a unit, e.g. "92.5". */
export function axisNumber(value: number, unit: Unit, locale: string): string {
  if (unit === "sec" || unit === "split") return value >= 60 ? `${Math.floor(value / 60)}:${String(Math.round(value % 60)).padStart(2, "0")}` : num(value, locale, 0);
  return num(value, locale, value < 10 ? 1 : 0);
}

const MONTH: Record<string, string> = { en: "en-IN", hi: "hi-IN", kn: "kn-IN" };
export const shortDay = (date: string, locale: string) =>
  new Intl.DateTimeFormat(MONTH[locale] ?? "en-IN", { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(`${date}T00:00:00Z`));
export const monthOf = (date: string, locale: string) =>
  new Intl.DateTimeFormat(MONTH[locale] ?? "en-IN", { timeZone: "UTC", month: "short" }).format(new Date(`${date}T00:00:00Z`));
export const longDay = (date: string, locale: string) =>
  new Intl.DateTimeFormat(MONTH[locale] ?? "en-IN", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${date}T00:00:00Z`));

/** One set as short text: "60 kg x 8", "45 s", "50 m in 1 min 1 s", "12 of 20", "Confident". */
export function formatSet(s: HistorySet, f: Fmt): string {
  const parts: string[] = [];
  if (s.weightKg !== null && s.reps !== null) parts.push(f.t("xp.set.weightReps", { w: num(s.weightKg, f.locale), r: num(s.reps, f.locale, 0) }));
  else if (s.weightKg !== null) parts.push(formatValue(s.weightKg, "kg", f));
  else if (s.reps !== null) parts.push(formatValue(s.reps, "reps", f));
  if (s.meters !== null) parts.push(formatValue(s.meters, "m", f));
  if (s.seconds !== null) parts.push(minSec(s.seconds, f));
  if (s.scoreMade !== null && s.scoreOf !== null) parts.push(f.t("xp.set.score", { made: s.scoreMade, of: s.scoreOf }));
  if (s.rating !== null) parts.push(formatValue(s.rating, "rating", f));
  return parts.join(" · ");
}
