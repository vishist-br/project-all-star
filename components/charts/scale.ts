export type Num = number | null;

export const SERIES_COLORS = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c5)"] as const;

/** Series colour by position, so charts keep the same order everywhere. */
export function seriesColor(index: number, explicit?: string): string {
  return explicit ?? SERIES_COLORS[index % SERIES_COLORS.length];
}

/** Round a maximum up to a tidy axis end (1, 2, 5 times a power of ten). Counts start at 0. */
export function niceMax(max: number): number {
  if (!Number.isFinite(max) || max <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  const f = max / pow;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * pow;
}

/** At most 5 gridline values from 0 to the axis end, inclusive. */
export function ticks(axisMax: number): number[] {
  const steps = axisMax >= 4 ? 4 : 2;
  return Array.from({ length: steps + 1 }, (_, i) => (axisMax / steps) * i);
}

export function maxOf(rows: Num[][]): number {
  let m = 0;
  for (const r of rows) for (const v of r) if (v !== null && v > m) m = v;
  return m;
}

/** One decimal is plenty for SVG coordinates; unrounded floats bloat the HTML and the serialized payload. */
export const r1 = (n: number): number => Math.round(n * 10) / 10;

export const fmt = (n: Num): string => (n === null ? "–" : Number.isInteger(n) ? String(n) : n.toFixed(1));

/** Split values into runs of non-null points so nulls render as gaps, never as 0. */
export function runs(points: { x: number; y: number | null }[]): { x: number; y: number }[][] {
  const out: { x: number; y: number }[][] = [];
  let cur: { x: number; y: number }[] = [];
  for (const p of points) {
    if (p.y === null) {
      if (cur.length) out.push(cur);
      cur = [];
    } else cur.push({ x: p.x, y: p.y });
  }
  if (cur.length) out.push(cur);
  return out;
}

export function linePath(run: { x: number; y: number }[]): string {
  return run.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
}
