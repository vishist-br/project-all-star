/**
 * Records and series over a member's set history for one exercise. Pure: no database, no clock.
 *
 * Conventions (documented in docs/WORKOUT-ENGINE-CONTRACT.md):
 *  - Warm-up sets never count toward records, series or volume.
 *  - weight is kg, time is seconds, distance is metres.
 *  - Estimated one-rep max uses the Epley formula: w * (1 + reps / 30); one rep is the weight itself.
 *  - Split is seconds per 100 m (lower is better); needs meters and seconds on the same set.
 *  - Best time is the longest single set in seconds (holds, drills). Best score is the best made/of
 *    ratio (ties go to more attempts made).
 */
export type SetTypeName = "NORMAL" | "WARMUP" | "DROP" | "FAILURE";

export type SetLike = {
  setType: SetTypeName;
  weightKg: number | null;
  reps: number | null;
  seconds: number | null;
  meters: number | null;
  scoreMade: number | null;
  scoreOf: number | null;
};

/** One logged session (a workout log) of the exercise, with its date (YYYY-MM-DD) and sets. */
export type HistorySession<S extends SetLike = SetLike> = { logId: string; date: string; sets: S[] };

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function epley1RM(weightKg: number, reps: number): number {
  if (!(weightKg > 0) || !(reps >= 1)) return 0;
  return reps === 1 ? weightKg : round2(weightKg * (1 + reps / 30));
}

export const countsForRecords = (s: SetLike) => s.setType !== "WARMUP";

/** weight x reps for one set (0 when either is missing). */
export function setVolume(s: SetLike): number {
  return s.weightKg && s.reps ? round2(s.weightKg * s.reps) : 0;
}

/** Seconds per 100 m, or null when the set has no distance or no time. */
export function splitPer100m(s: SetLike): number | null {
  if (!s.meters || !s.seconds || s.meters <= 0 || s.seconds <= 0) return null;
  return round2((s.seconds / s.meters) * 100);
}

export function scoreRatio(s: SetLike): number | null {
  if (s.scoreMade === null || s.scoreOf === null || s.scoreOf <= 0) return null;
  return round2((s.scoreMade / s.scoreOf) * 100);
}

export type SessionMetrics = {
  date: string;
  logId: string;
  heaviestWeight: number | null;
  oneRepMax: number | null;
  bestSetVolume: number | null;
  sessionVolume: number | null;
  totalReps: number | null;
  bestTime: number | null;
  bestSplit: number | null;
  bestScore: number | null; // percent made
};

const max = (xs: number[]) => (xs.length ? Math.max(...xs) : null);
const min = (xs: number[]) => (xs.length ? Math.min(...xs) : null);
const positive = (xs: (number | null)[]) => xs.filter((x): x is number => x !== null && x > 0);

/** Every metric of one session. A metric with no data in the session is null. */
export function sessionMetrics(session: HistorySession): SessionMetrics {
  const sets = session.sets.filter(countsForRecords);
  const volumes = sets.map(setVolume).filter((v) => v > 0);
  const reps = sets.map((s) => s.reps ?? 0);
  const totalReps = reps.reduce((a, b) => a + b, 0);
  const ratios = sets.map(scoreRatio).filter((x): x is number => x !== null);
  return {
    date: session.date,
    logId: session.logId,
    heaviestWeight: max(positive(sets.map((s) => s.weightKg))),
    oneRepMax: max(sets.map((s) => (s.weightKg && s.reps ? epley1RM(s.weightKg, s.reps) : 0)).filter((v) => v > 0)),
    bestSetVolume: max(volumes),
    sessionVolume: volumes.length ? round2(volumes.reduce((a, b) => a + b, 0)) : null,
    totalReps: totalReps > 0 ? totalReps : null,
    bestTime: max(positive(sets.map((s) => s.seconds))),
    bestSplit: min(positive(sets.map(splitPer100m))),
    bestScore: max(ratios),
  };
}

export type SeriesPoint = { date: string; value: number };
export type Series = {
  heaviestWeight: SeriesPoint[];
  oneRepMax: SeriesPoint[];
  bestSetVolume: SeriesPoint[];
  sessionVolume: SeriesPoint[];
  totalReps: SeriesPoint[];
  bestTime: SeriesPoint[];
  bestSplit: SeriesPoint[];
  bestScore: SeriesPoint[];
};

export const SERIES_KEYS = ["heaviestWeight", "oneRepMax", "bestSetVolume", "sessionVolume", "totalReps", "bestTime", "bestSplit", "bestScore"] as const;
export type SeriesKey = (typeof SERIES_KEYS)[number];
/** Lower is better only for split. */
export const LOWER_IS_BETTER: ReadonlySet<SeriesKey> = new Set(["bestSplit"]);

const byDate = <T extends { date: string; logId: string }>(a: T, b: T) => a.date.localeCompare(b.date) || a.logId.localeCompare(b.logId);

/** One point per session and metric, oldest first. Sessions on the same day are separate points. */
export function buildSeries(sessions: HistorySession[]): Series {
  const metrics = [...sessions].sort(byDate).map(sessionMetrics);
  const out = Object.fromEntries(SERIES_KEYS.map((k) => [k, [] as SeriesPoint[]])) as Series;
  for (const m of metrics) for (const k of SERIES_KEYS) if (m[k] !== null) out[k].push({ date: m.date, value: m[k]! });
  return out;
}

export type RecordValue = { value: number; date: string };
export type RepRecord = { reps: number; weightKg: number; date: string };
export type Records = {
  heaviestWeight: RecordValue | null;
  oneRepMax: RecordValue | null;
  bestSetVolume: RecordValue | null;
  bestSessionVolume: RecordValue | null;
  mostReps: RecordValue | null; // most reps in one set
  longestTime: RecordValue | null;
  bestSplit: RecordValue | null;
  bestScore: RecordValue | null; // percent
  /** Heaviest weight at each rep count, ascending by reps. */
  weightAtReps: RepRecord[];
};

/** Ties keep the earliest date, so "set on" stays the first time the value was reached. */
function best(points: { date: string; value: number }[], lower = false): RecordValue | null {
  let cur: RecordValue | null = null;
  for (const p of points) {
    if (cur === null || (lower ? p.value < cur.value : p.value > cur.value)) cur = { value: p.value, date: p.date };
  }
  return cur;
}

export function buildRecords(sessions: HistorySession[]): Records {
  const ordered = [...sessions].sort(byDate);
  const perSet = (pick: (s: SetLike) => number | null) =>
    ordered.flatMap((sess) => sess.sets.filter(countsForRecords).map((s) => ({ date: sess.date, value: pick(s) })).filter((p): p is { date: string; value: number } => p.value !== null && p.value > 0));
  const metrics = ordered.map(sessionMetrics);
  const pts = (k: SeriesKey) => metrics.filter((m) => m[k] !== null).map((m) => ({ date: m.date, value: m[k]! }));

  const repMap = new Map<number, RepRecord>();
  for (const sess of ordered) {
    for (const s of sess.sets.filter(countsForRecords)) {
      if (!s.weightKg || s.weightKg <= 0 || !s.reps || s.reps <= 0) continue;
      const cur = repMap.get(s.reps);
      if (!cur || s.weightKg > cur.weightKg) repMap.set(s.reps, { reps: s.reps, weightKg: s.weightKg, date: sess.date });
    }
  }
  return {
    heaviestWeight: best(perSet((s) => s.weightKg)),
    oneRepMax: best(perSet((s) => (s.weightKg && s.reps ? epley1RM(s.weightKg, s.reps) : null))),
    bestSetVolume: best(perSet((s) => setVolume(s))),
    bestSessionVolume: best(pts("sessionVolume")),
    mostReps: best(perSet((s) => s.reps)),
    longestTime: best(perSet((s) => s.seconds)),
    bestSplit: best(perSet(splitPer100m), true),
    bestScore: best(perSet(scoreRatio)),
    weightAtReps: [...repMap.values()].sort((a, b) => a.reps - b.reps),
  };
}

/** Metrics that can be a new best, with the name used in API responses (`newBests[].metric`). */
export const BEST_KINDS = [
  ["heaviestWeight", "heaviest_weight"],
  ["oneRepMax", "one_rep_max"],
  ["bestSetVolume", "best_set_volume"],
  ["sessionVolume", "session_volume"],
  ["totalReps", "most_reps"],
  ["bestTime", "longest_time"],
  ["bestSplit", "best_split"],
  ["bestScore", "best_score"],
] as const satisfies readonly (readonly [SeriesKey, string])[];
export type BestKind = (typeof BEST_KINDS)[number][1];

export type NewBest = { logId: string; date: string; metric: BestKind; value: number; previous: number };

/**
 * New bests per session, oldest first. A session beats an earlier best only when there is an
 * earlier session with data for that metric (the first ever value is a baseline, not a record).
 * `onlyLogIds` limits the output to those sessions (history is still read in full).
 */
export function findNewBests(sessions: HistorySession[], onlyLogIds?: ReadonlySet<string>): NewBest[] {
  const metrics = [...sessions].sort(byDate).map(sessionMetrics);
  const out: NewBest[] = [];
  const prior = {} as Record<SeriesKey, number | null>;
  for (const k of SERIES_KEYS) prior[k] = null;
  for (const m of metrics) {
    for (const [key, name] of BEST_KINDS) {
      const v = m[key];
      if (v === null) continue;
      const before = prior[key];
      const better = before === null ? false : LOWER_IS_BETTER.has(key) ? v < before : v > before;
      if (better && (!onlyLogIds || onlyLogIds.has(m.logId))) out.push({ logId: m.logId, date: m.date, metric: name, value: v, previous: before! });
      if (before === null || (LOWER_IS_BETTER.has(key) ? v < before : v > before)) prior[key] = v;
    }
  }
  return out;
}

/** Totals for a log derived from its sets: warm-ups are not counted as work sets. */
export function deriveLogTotals(sets: SetLike[]): { actualSets: number; actualReps: number; actualDurationSeconds: number | null } {
  const work = sets.filter(countsForRecords);
  const seconds = work.reduce((a, s) => a + (s.seconds ?? 0), 0);
  return {
    actualSets: work.length,
    actualReps: work.reduce((a, s) => a + (s.reps ?? 0), 0),
    actualDurationSeconds: seconds > 0 ? seconds : null,
  };
}

export type HistoryRange = "3m" | "1y" | "all";
export const HISTORY_RANGES: readonly HistoryRange[] = ["3m", "1y", "all"];

/** First date (YYYY-MM-DD) included in the range, or null for "all". */
export function rangeStart(range: HistoryRange, today: string): string | null {
  if (range === "all") return null;
  const d = new Date(`${today}T00:00:00Z`);
  if (range === "3m") d.setUTCMonth(d.getUTCMonth() - 3);
  else d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d.toISOString().slice(0, 10);
}
