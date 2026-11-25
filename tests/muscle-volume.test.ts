import { describe, expect, it } from "vitest";
import { aggregateMuscleVolume, type MuscleSet } from "../lib/workouts/muscle-volume";
import { availableMetrics, deltaText, muscleLabel, numText, parseNumberInput, pointsFor, type MeasurementLike } from "../lib/gym-extras/view";
import { translate } from "../lib/i18n";
import { parseMeasurementInput } from "../lib/api/body-measurements";

const set = (o: Partial<MuscleSet> = {}): MuscleSet => ({ setType: "NORMAL", weightKg: 50, reps: 10, primaryMuscles: ["quadriceps"], ...o });

describe("aggregateMuscleVolume", () => {
  it("counts sets and volume per primary muscle, most sets first", () => {
    const r = aggregateMuscleVolume([set(), set(), set({ primaryMuscles: ["chest"], weightKg: 40, reps: 8 })], 1);
    expect(r.muscles).toEqual([
      { muscle: "quadriceps", sets: 2, volumeKg: 1000, setsPerWeek: 2 },
      { muscle: "chest", sets: 1, volumeKg: 320, setsPerWeek: 1 },
    ]);
    expect(r.totalSets).toBe(3);
    expect(r.totalVolumeKg).toBe(1320);
  });

  it("never counts warm-up sets, and ignores sets without reps", () => {
    const r = aggregateMuscleVolume([set({ setType: "WARMUP" }), set({ reps: null }), set({ reps: 0 }), set()], 1);
    expect(r.totalSets).toBe(1);
    expect(r.muscles[0]).toMatchObject({ muscle: "quadriceps", sets: 1 });
  });

  it("drop and failure sets count; bodyweight sets add a set but no volume", () => {
    const r = aggregateMuscleVolume([set({ setType: "DROP" }), set({ setType: "FAILURE" }), set({ weightKg: null, reps: 12 })], 1);
    expect(r.totalSets).toBe(3);
    expect(r.totalVolumeKg).toBe(1000);
  });

  it("a set counts once for each of its primary muscles (case folded, no duplicates)", () => {
    const r = aggregateMuscleVolume([set({ primaryMuscles: ["Chest", "chest", "triceps"], weightKg: 20, reps: 10 })], 1);
    expect(r.muscles.map((m) => [m.muscle, m.sets, m.volumeKg])).toEqual([["chest", 1, 200], ["triceps", 1, 200]]);
    expect(r.totalSets).toBe(1);
    expect(r.totalVolumeKg).toBe(200);
  });

  it("gives sets per week over the window and a stable order for ties", () => {
    const sets = Array.from({ length: 6 }, () => set({ primaryMuscles: ["lats"] }));
    sets.push(set({ primaryMuscles: ["biceps"] }), set({ primaryMuscles: ["abdominals"] }));
    const r = aggregateMuscleVolume(sets, 4);
    expect(r.muscles[0]).toMatchObject({ muscle: "lats", sets: 6, setsPerWeek: 1.5 });
    expect(r.muscles.slice(1).map((m) => m.muscle)).toEqual(["abdominals", "biceps"]);
  });

  it("returns empty lists for no sets", () => {
    expect(aggregateMuscleVolume([], 1)).toEqual({ muscles: [], totalSets: 0, totalVolumeKg: 0 });
  });
});

describe("body measurement input", () => {
  const today = "2026-11-26";
  it("needs a weight and defaults the date to today; optional fields stay null", () => {
    const r = parseMeasurementInput({ weightKg: 61.24 }, today);
    expect(r).toMatchObject({ measuredOn: today, weightKg: 61.2, bodyFatPct: null, waistCm: null, note: null });
  });
  it("rejects bad numbers, future dates and a missing weight with field details", () => {
    const fields = (body: unknown) => {
      try {
        parseMeasurementInput(body, today);
        return [];
      } catch (e) {
        return ((e as { details?: { field: string }[] }).details ?? []).map((d) => d.field);
      }
    };
    expect(fields({})).toEqual(["weightKg"]);
    expect(fields({ weightKg: 5 })).toEqual(["weightKg"]);
    expect(fields({ weightKg: 60, measuredOn: "2026-12-01" })).toEqual(["measuredOn"]);
    expect(fields({ weightKg: 60, bodyFatPct: 90, waistCm: "x", note: "n".repeat(300) })).toEqual(["bodyFatPct", "waistCm", "note"]);
  });
});

describe("view helpers", () => {
  const e = (id: string, day: string, o: Partial<MeasurementLike> = {}): MeasurementLike => ({
    id, measuredOn: day, weightKg: 60, bodyFatPct: null, chestCm: null, waistCm: null, hipCm: null, armCm: null, thighCm: null, ...o,
  });
  it("offers weight always and other metrics only when recorded", () => {
    expect(availableMetrics([e("a", "2026-01-01")])).toEqual(["weightKg"]);
    expect(availableMetrics([e("a", "2026-01-01", { waistCm: 80 })])).toEqual(["weightKg", "waistCm"]);
  });
  it("builds chart points per metric, skipping entries without it", () => {
    const items = [e("a", "2026-01-01", { waistCm: 80 }), e("b", "2026-01-15"), e("c", "2026-02-01", { waistCm: 79.5 })];
    expect(pointsFor(items, "waistCm")).toEqual([{ date: "2026-01-01", value: 80 }, { date: "2026-02-01", value: 79.5 }]);
  });
  it("formats numbers and differences neutrally", () => {
    expect(numText(61.50)).toBe("61.5");
    expect(numText(60)).toBe("60");
    expect(deltaText(60, 61.2)).toBe("+1.2");
    expect(deltaText(61.2, 60)).toBe("-1.2");
    expect(deltaText(60, 60)).toBe("0");
  });
  it("parses typed numbers with a comma or a dot, empty as null and junk as NaN", () => {
    expect(parseNumberInput("61,5")).toBe(61.5);
    expect(parseNumberInput(" 61.5 ")).toBe(61.5);
    expect(parseNumberInput("")).toBeNull();
    expect(parseNumberInput("6x")).toBeNaN();
    expect(parseNumberInput("-3")).toBeNaN();
  });
  it("translates known muscles and capitalises unknown ones", () => {
    const t = (k: Parameters<typeof translate>[1]) => translate("hi", k);
    expect(muscleLabel(t, "chest")).toBe("सीना");
    expect(muscleLabel(t, "hip flexors")).toBe("Hip flexors");
  });
});
