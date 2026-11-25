/** Geometry for the exercise line chart: a time-scaled x axis and a padded y axis that does not force zero. */

const DAY = 86_400_000;
const t = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** Tidy tick values covering [min, max] (round steps of 1, 2, 2.5, 5 times a power of ten). */
export function niceTicks(min: number, max: number): { lo: number; hi: number; ticks: number[] } {
  if (min === max) {
    const pad = Math.max(1, Math.abs(max) * 0.1);
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / 2;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow;
  let lo = Math.floor(min / step) * step;
  if (lo < 0) lo = 0;
  const hi = Math.max(lo + step * 2, Math.ceil(max / step) * step);
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 1000; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return { lo, hi, ticks };
}

/** x positions (0..1) by date; a single point sits in the middle. */
export function xFractions(dates: string[]): number[] {
  if (dates.length === 0) return [];
  const a = t(dates[0]!);
  const span = t(dates[dates.length - 1]!) - a;
  if (span <= 0) return dates.map(() => 0.5);
  return dates.map((d) => (t(d) - a) / span);
}

export const daysBetween = (a: string, b: string) => Math.round((t(b) - t(a)) / DAY);
