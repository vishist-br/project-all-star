import { describe, expect, it } from "vitest";
import {
  chartModel,
  effectiveMetricType,
  emptyKind,
  formatSet,
  formatValue,
  metricsFor,
  overviewOf,
  parseRange,
  repRecords,
  selectMetric,
  seriesFor,
  statTiles,
  type HistoryLike,
  type HistorySet,
} from "../lib/exercise/metrics";
import { niceTicks, xFractions } from "../lib/exercise/scale";
import { translate } from "../lib/i18n";

const set = (o: Partial<HistorySet> = {}): HistorySet => ({ setType: "normal", weightKg: null, reps: null, seconds: null, meters: null, scoreMade: null, scoreOf: null, rating: null, ...o });
const emptySeries = { heaviestWeight: [], oneRepMax: [], bestSetVolume: [], sessionVolume: [], totalReps: [], bestTime: [], bestSplit: [], bestScore: [] };
const emptyRecords = { heaviestWeight: null, oneRepMax: null, mostReps: null, longestTime: null, bestSplit: null, bestScore: null, weightAtReps: [] };
const hist = (o: Partial<HistoryLike> = {}): HistoryLike => ({ metricType: "WEIGHT_REPS", from: null, sessions: [], series: { ...emptySeries }, records: { ...emptyRecords }, newBests: [], ...o });

const f = { t: (k: Parameters<typeof translate>[1], p?: Record<string, string | number>) => translate("en", k, p), locale: "en" };

const strength = hist({
  sessions: [
    { logId: "b", date: "2026-11-20", status: "completed", sets: [set({ setType: "warmup", weightKg: 20, reps: 10 }), set({ weightKg: 90, reps: 5 })] },
    { logId: "a", date: "2026-10-01", status: "completed", sets: [set({ weightKg: 80, reps: 5 })] },
  ],
  series: {
    ...emptySeries,
    heaviestWeight: [{ date: "2026-10-01", value: 80 }, { date: "2026-11-20", value: 90 }],
    oneRepMax: [{ date: "2026-10-01", value: 93.3 }, { date: "2026-11-20", value: 105 }],
  },
  records: { ...emptyRecords, heaviestWeight: { value: 90, date: "2026-11-20" }, oneRepMax: { value: 105, date: "2026-11-20" }, weightAtReps: [{ reps: 5, weightKg: 90, date: "2026-11-20" }] },
  newBests: [{ logId: "b", date: "2026-11-20", metric: "heaviest_weight", value: 90, previous: 80 }],
});

describe("metric chips per metric type", () => {
  it("offers the five weight and reps chips", () => {
    expect(metricsFor(strength).map((m) => m.id)).toEqual(["heaviestWeight", "oneRepMax", "bestSetVolume", "sessionVolume", "totalReps"]);
  });
  it.each([
    ["TIME", ["bestTime", "totalTime"]],
    ["DISTANCE_TIME", ["bestSplit", "distance"]],
    ["SCORE", ["bestScore", "scoreMade"]],
    ["REPS", ["bestReps", "totalReps"]],
    ["CHECKLIST", ["rating"]],
  ])("%s chips", (type, ids) => {
    expect(metricsFor(hist({ metricType: type })).map((m) => m.id)).toEqual(ids);
  });
  it("falls back to the first chip for an unknown metric", () => {
    expect(selectMetric(strength, "nonsense").id).toBe("heaviestWeight");
    expect(selectMetric(strength, "oneRepMax").id).toBe("oneRepMax");
    expect(selectMetric(strength, "bestTime").id).toBe("heaviestWeight");
  });
  it("treats a gym exercise with only times as a time exercise (plank)", () => {
    const plank = hist({ sessions: [{ logId: "p", date: "2026-11-01", sets: [set({ seconds: 45 })] }], series: { ...emptySeries, bestTime: [{ date: "2026-11-01", value: 45 }] } });
    expect(effectiveMetricType(plank)).toBe("TIME");
    expect(metricsFor(plank)[0]!.id).toBe("bestTime");
  });
});

describe("series mapping", () => {
  it("uses the API series, oldest first", () => {
    expect(seriesFor(strength, "heaviestWeight").map((p) => p.value)).toEqual([80, 90]);
  });
  it("filters by the range start", () => {
    const ranged = { ...strength, from: "2026-11-01" };
    expect(seriesFor(ranged, "heaviestWeight")).toEqual([{ date: "2026-11-20", value: 90 }]);
  });
  it("derives per-session series the API does not send, skipping warm-ups", () => {
    const reps = hist({
      metricType: "REPS",
      sessions: [
        { logId: "2", date: "2026-11-10", sets: [set({ setType: "warmup", reps: 99 }), set({ reps: 12 }), set({ reps: 15 })] },
        { logId: "1", date: "2026-11-01", sets: [set({ reps: 10 })] },
      ],
    });
    expect(seriesFor(reps, "bestReps")).toEqual([{ date: "2026-11-01", value: 10 }, { date: "2026-11-10", value: 15 }]);
    const swim = hist({ metricType: "DISTANCE_TIME", sessions: [{ logId: "1", date: "2026-11-01", sets: [set({ meters: 50, seconds: 60 }), set({ meters: 50, seconds: 58 })] }] });
    expect(seriesFor(swim, "distance")).toEqual([{ date: "2026-11-01", value: 100 }]);
    const drill = hist({ metricType: "TIME", sessions: [{ logId: "1", date: "2026-11-01", sets: [set({ seconds: 30 }), set({ seconds: 45 })] }] });
    expect(seriesFor(drill, "totalTime")).toEqual([{ date: "2026-11-01", value: 75 }]);
    const score = hist({ metricType: "SCORE", sessions: [{ logId: "1", date: "2026-11-01", sets: [set({ scoreMade: 12, scoreOf: 20 }), set({ scoreMade: 15, scoreOf: 20 })] }] });
    expect(seriesFor(score, "scoreMade")).toEqual([{ date: "2026-11-01", value: 15 }]);
  });
  it("builds the chart model with latest point and the new-best mark", () => {
    const m = chartModel(strength, selectMetric(strength, "heaviestWeight"));
    expect(m.latest).toEqual({ date: "2026-11-20", value: 90 });
    expect(m.first?.value).toBe(80);
    expect([m.min, m.max]).toEqual([80, 90]);
    expect(m.newBestDate).toBe("2026-11-20");
    expect(chartModel(strength, selectMetric(strength, "oneRepMax")).newBestDate).toBeNull();
  });
});

describe("headline tiles", () => {
  it("weight and reps: best weight, est. max, sessions", () => {
    const tiles = statTiles(strength);
    expect(tiles.map((t) => [t.label, t.value])).toEqual([["xp.tile.bestWeight", 90], ["xp.tile.estMax", 105], ["xp.tile.sessions", 2]]);
    expect(formatValue(90, "kg", f)).toBe("90 kg");
  });
  it("adapts to time, swim, score, reps", () => {
    const drill = hist({ metricType: "TIME", sessions: [{ logId: "1", date: "2026-11-01", sets: [set({ seconds: 30 }), set({ seconds: 45 })] }], records: { ...emptyRecords, longestTime: { value: 45, date: "2026-11-01" } } });
    expect(statTiles(drill).map((t) => [t.label, t.value])).toEqual([["xp.tile.bestTime", 45], ["xp.tile.totalTime", 75], ["xp.tile.sessions", 1]]);
    const swim = hist({ metricType: "DISTANCE_TIME", sessions: [{ logId: "1", date: "2026-11-01", sets: [set({ meters: 100, seconds: 120 })] }], records: { ...emptyRecords, bestSplit: { value: 120, date: "2026-11-01" } } });
    expect(statTiles(swim).map((t) => t.label)).toEqual(["xp.tile.bestSplit", "xp.tile.distance", "xp.tile.sessions"]);
    expect(statTiles(swim)[1]!.value).toBe(100);
    const score = hist({ metricType: "SCORE", sessions: [{ logId: "1", date: "2026-11-01", sets: [set({ scoreMade: 12, scoreOf: 20 })] }], records: { ...emptyRecords, bestScore: { value: 60, date: "2026-11-01" } } });
    expect(statTiles(score).map((t) => t.value)).toEqual([60, 12, 1]);
    const reps = hist({ metricType: "REPS", sessions: [{ logId: "1", date: "2026-11-01", sets: [set({ reps: 10 }), set({ reps: 8 })] }], records: { ...emptyRecords, mostReps: { value: 10, date: "2026-11-01" } } });
    expect(statTiles(reps).map((t) => t.value)).toEqual([10, 18, 1]);
  });
  it("shows no value rather than zero when nothing is logged", () => {
    expect(statTiles(hist())[0]!.value).toBeNull();
    expect(formatValue(null, "kg", f)).toBe("No data yet");
  });
});

describe("records and empty states", () => {
  it("lists rep records only for weight and reps", () => {
    expect(repRecords(strength)).toHaveLength(1);
    expect(repRecords(hist({ metricType: "TIME", records: { ...emptyRecords, weightAtReps: [{ reps: 5, weightKg: 1, date: "2026-11-01" }] } }))).toEqual([]);
  });
  it("tells never-logged from nothing-in-range", () => {
    expect(emptyKind(hist())).toBe("none");
    expect(emptyKind(hist({ records: { ...emptyRecords, heaviestWeight: { value: 50, date: "2026-01-01" } } }))).toBe("range");
    expect(emptyKind(strength)).toBeNull();
  });
  it("summarises for the overview list", () => {
    const o = overviewOf(strength);
    expect(o.latest?.value).toBe(90);
    expect(o.spark).toEqual([80, 90]);
  });
});

describe("range and formatting helpers", () => {
  it("parses the range with a safe default", () => {
    expect(parseRange("1y")).toBe("1y");
    expect(parseRange("all")).toBe("all");
    expect(parseRange("5y")).toBe("3m");
    expect(parseRange(undefined)).toBe("3m");
  });
  it("formats durations and sets", () => {
    expect(formatValue(45, "sec", f)).toBe("45 s");
    expect(formatValue(125, "sec", f)).toBe("2 min 5 s");
    expect(formatValue(121, "split", f)).toBe("2 min 1 s per 100 m");
    expect(formatSet(set({ weightKg: 60, reps: 8 }), f)).toBe("60 kg x 8");
    expect(formatSet(set({ scoreMade: 12, scoreOf: 20 }), f)).toBe("12 of 20");
    expect(formatSet(set({ rating: 3 }), f)).toBe("Confident");
  });
  it("scales the axis without forcing zero and places a single point in the middle", () => {
    const t = niceTicks(80, 90);
    expect(t.lo).toBeLessThanOrEqual(80);
    expect(t.hi).toBeGreaterThanOrEqual(90);
    expect(niceTicks(50, 50).ticks.length).toBeGreaterThanOrEqual(3);
    expect(xFractions(["2026-11-01"])).toEqual([0.5]);
    expect(xFractions(["2026-11-01", "2026-11-11", "2026-11-21"])).toEqual([0, 0.5, 1]);
  });
});
