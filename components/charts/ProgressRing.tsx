import { ChartFrame } from "./ChartFrame";
import { fmt } from "./scale";

const R = 42;
const C = 2 * Math.PI * R;

/** Single progress value (0 to max, default 100) as a ring with the value in the centre. */
export function ProgressRing({ value, max = 100, label, centerLabel, ariaLabel, valueLabel, maxLabel }: { value: number | null; max?: number; label: string; centerLabel?: string; ariaLabel: string; valueLabel: string; maxLabel: string }) {
  const ratio = value === null ? 0 : Math.min(1, Math.max(0, value / max));
  return (
    <ChartFrame
      className="chart-donut"
      ariaLabel={ariaLabel}
      viewBox="0 0 120 120"
      table={{ columns: [valueLabel, maxLabel], rows: [{ label, values: [value, max] }] }}
    >
      <circle cx="60" cy="60" r={R} className="chart-track" />
      {ratio > 0 && (
        <circle cx="60" cy="60" r={R} className="chart-arc" stroke="var(--c1)" strokeDasharray={`${ratio * C} ${C}`} transform="rotate(-90 60 60)" />
      )}
      <text x="60" y="65" textAnchor="middle" className="chart-center">{centerLabel ?? (value === null ? "–" : fmt(value))}</text>
    </ChartFrame>
  );
}
