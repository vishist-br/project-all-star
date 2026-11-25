import { messages, type MessageKey } from "../i18n";

/** Body measurement fields, in the order the screens show them. `unit` picks the value template. */
export const BODY_METRICS = [
  { key: "weightKg", label: "gx.bm.weight", unit: "kg" },
  { key: "bodyFatPct", label: "gx.bm.bodyFat", unit: "pct" },
  { key: "chestCm", label: "gx.bm.chest", unit: "cm" },
  { key: "waistCm", label: "gx.bm.waist", unit: "cm" },
  { key: "hipCm", label: "gx.bm.hip", unit: "cm" },
  { key: "armCm", label: "gx.bm.arm", unit: "cm" },
  { key: "thighCm", label: "gx.bm.thigh", unit: "cm" },
] as const satisfies readonly { key: string; label: MessageKey; unit: "kg" | "pct" | "cm" }[];

export type BodyMetricKey = (typeof BODY_METRICS)[number]["key"];

export const isBodyMetric = (v: unknown): v is BodyMetricKey => BODY_METRICS.some((m) => m.key === v);

export type MeasurementLike = { id: string; measuredOn: string; note?: string | null } & Record<BodyMetricKey, number | null>;

/** One decimal at most, no trailing zero: 41.5, 60. */
export const numText = (n: number) => String(Math.round(n * 10) / 10);

export const UNIT_KEY = { kg: "gx.bm.vKg", pct: "gx.bm.vPct", cm: "gx.bm.vCm" } as const satisfies Record<string, MessageKey>;

/** Chart points (oldest first) for one metric, skipping entries that did not record it. */
export function pointsFor(items: readonly MeasurementLike[], key: BodyMetricKey): { date: string; value: number }[] {
  return items.flatMap((i) => (i[key] === null ? [] : [{ date: i.measuredOn, value: i[key] as number }]));
}

/** Metrics that have at least one entry; weight is always offered. */
export function availableMetrics(items: readonly MeasurementLike[]): BodyMetricKey[] {
  return BODY_METRICS.filter((m) => m.key === "weightKg" || items.some((i) => i[m.key] !== null)).map((m) => m.key);
}

/** Signed difference text, e.g. "+1.2" or "-0.8" (neutral wording: the screens only show the number). */
export function deltaText(from: number, to: number): string {
  const d = Math.round((to - from) * 10) / 10;
  return d > 0 ? `+${numText(d)}` : d < 0 ? `-${numText(Math.abs(d))}` : "0";
}

/** Muscle names come from the exercise catalog in lowercase English; known ones are translated. */
export function muscleLabel(t: (key: MessageKey) => string, muscle: string): string {
  const key = `gx.muscle.${muscle}`;
  if (key in messages.en) return t(key as MessageKey);
  return muscle.charAt(0).toUpperCase() + muscle.slice(1);
}

/** Parses what a person typed into a number input ("61,5" and "61.5" both work). Empty is null, junk is NaN. */
export function parseNumberInput(raw: string): number | null | typeof Number.NaN {
  const s = raw.trim().replace(",", ".");
  if (s === "") return null;
  if (!/^\d+(\.\d+)?$/.test(s)) return Number.NaN;
  return Number(s);
}
