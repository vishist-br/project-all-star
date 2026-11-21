import { linePath, runs, seriesColor, type Num } from "./scale";

const W = 100;
const H = 28;

/** Tiny trend line for stat tiles. Nulls are gaps. */
export function Sparkline({ values, ariaLabel, color }: { values: Num[]; ariaLabel: string; color?: string }) {
  const nums = values.filter((v): v is number => v !== null);
  const lo = Math.min(0, ...nums);
  const hi = Math.max(1, ...nums);
  const x = (i: number) => (values.length <= 1 ? W / 2 : 2 + (i / (values.length - 1)) * (W - 4));
  const y = (v: number) => H - 3 - ((v - lo) / (hi - lo)) * (H - 6);
  const pieces = runs(values.map((v, i) => ({ x: x(i), y: v === null ? null : y(v) })));
  return (
    <svg role="img" aria-label={ariaLabel} viewBox={`0 0 ${W} ${H}`} className="sparkline" preserveAspectRatio="none">
      {pieces.map((r, i) => (
        <path key={i} className="chart-line" vectorEffect="non-scaling-stroke" stroke={seriesColor(0, color)} d={linePath(r)} />
      ))}
    </svg>
  );
}
