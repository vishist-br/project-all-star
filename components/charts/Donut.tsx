import { ChartFrame } from "./ChartFrame";
import { fmt, seriesColor } from "./scale";

export type Slice = { label: string; value: number; color?: string };

const R = 42;
const C = 2 * Math.PI * R;

/** Up to 5 slices with a centre label. Slices are drawn as stroked arcs, so the geometry stays simple. */
export function Donut({ slices, centerLabel, centerSub, ariaLabel, valueLabel }: { slices: Slice[]; centerLabel: string; centerSub?: string; ariaLabel: string; valueLabel: string }) {
  const used = slices.slice(0, 5);
  const total = used.reduce((a, s) => a + s.value, 0);
  let offset = 0;
  return (
    <ChartFrame
      className="chart-donut"
      ariaLabel={ariaLabel}
      viewBox="0 0 120 120"
      legend={used.map((s, i) => ({ name: s.label, color: seriesColor(i, s.color) }))}
      table={{ columns: [valueLabel], rows: used.map((s) => ({ label: s.label, values: [s.value] })) }}
    >
      <circle cx="60" cy="60" r={R} className="chart-track" />
      {total > 0 &&
        used.map((s, i) => {
          const len = (s.value / total) * C;
          const el = s.value > 0 && (
            <circle key={s.label} cx="60" cy="60" r={R} className="chart-arc" stroke={seriesColor(i, s.color)} strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset} transform="rotate(-90 60 60)">
              <title>{`${s.label}: ${fmt(s.value)}`}</title>
            </circle>
          );
          offset += len;
          return el;
        })}
      <text x="60" y={centerSub ? 59 : 65} textAnchor="middle" className="chart-center">{centerLabel}</text>
      {centerSub && <text x="60" y="74" textAnchor="middle" className="chart-text">{centerSub}</text>}
    </ChartFrame>
  );
}
