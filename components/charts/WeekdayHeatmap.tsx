import { ChartFrame } from "./ChartFrame";
import { fmt, type Num } from "./scale";

/** One cell per label (Monday to Sunday), tinted by value relative to the busiest day. Nulls stay empty. */
export function WeekdayHeatmap({ labels, values, ariaLabel, valueLabel }: { labels: string[]; values: Num[]; ariaLabel: string; valueLabel: string }) {
  const max = Math.max(1, ...values.map((v) => v ?? 0));
  const cell = 40;
  return (
    <ChartFrame
      ariaLabel={ariaLabel}
      viewBox={`0 0 ${cell * labels.length} 64`}
      table={{ columns: [valueLabel], rows: labels.map((l, i) => ({ label: l, values: [values[i] ?? null] })) }}
    >
      {labels.map((l, i) => {
        const v = values[i] ?? null;
        return (
          <g key={l}>
            <rect x={i * cell + 2} y={2} width={cell - 4} height={34} rx={6} className={v === null ? "chart-cell-empty" : "chart-cell"} style={v === null ? undefined : { opacity: 0.2 + 0.8 * (v / max) }}>
              <title>{`${l}: ${fmt(v)}`}</title>
            </rect>
            <text x={i * cell + cell / 2} y={24} textAnchor="middle" className="chart-text chart-cell-value">{fmt(v)}</text>
            <text x={i * cell + cell / 2} y={54} textAnchor="middle" className="chart-text">{l}</text>
          </g>
        );
      })}
    </ChartFrame>
  );
}
