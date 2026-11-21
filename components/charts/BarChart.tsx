import { Axes, PAD, PLOT_H, PLOT_W, W, H, yAt } from "./Axes";
import { ChartFrame, legendOf, type Series } from "./ChartFrame";
import { fmt, maxOf, niceMax, seriesColor } from "./scale";

type Props = { labels: string[]; series: Series[]; ariaLabel: string; percent?: boolean; unit?: string };

function Bars({ labels, series, ariaLabel, percent, unit, stacked }: Props & { stacked: boolean }) {
  const totals = labels.map((_, i) => series.reduce((a, s) => a + (s.values[i] ?? 0), 0));
  const axisMax = percent ? 100 : niceMax(stacked ? Math.max(0, ...totals) : maxOf(series.map((s) => s.values)));
  const band = PLOT_W / Math.max(1, labels.length);
  const xCenter = (i: number) => PAD.l + band * (i + 0.5);
  const group = band * 0.72;
  const each = stacked ? group : group / Math.max(1, series.length);
  return (
    <ChartFrame
      ariaLabel={ariaLabel}
      viewBox={`0 0 ${W} ${H}`}
      legend={legendOf(series)}
      table={{ columns: series.map((s) => s.name), rows: labels.map((l, i) => ({ label: l, values: series.map((s) => s.values[i] ?? null) })) }}
    >
      <Axes axisMax={axisMax} labels={labels} xAt={xCenter} unit={percent ? "%" : unit} />
      {labels.map((l, i) => {
        let base = 0;
        return series.map((s, si) => {
          const v = s.values[i];
          if (v === null || v === undefined) return null; // gap, never 0
          const y0 = yAt(stacked ? base + v : v, axisMax);
          const h = Math.max(0, (v / axisMax) * PLOT_H);
          const x = stacked ? xCenter(i) - group / 2 : xCenter(i) - group / 2 + si * each;
          if (stacked) base += v;
          return (
            <rect key={`${i}-${si}`} className="chart-bar" x={x} y={y0} width={Math.max(1, each - 1)} height={h} rx={2} fill={seriesColor(si, s.color)}>
              <title>{`${s.name}, ${l}: ${fmt(v)}`}</title>
            </rect>
          );
        });
      })}
    </ChartFrame>
  );
}

/** Grouped bars: one bar per series for each label. Counts start at 0; `percent` fixes 0-100. */
export function BarChart(props: Props) {
  return <Bars {...props} stacked={false} />;
}

/** Series stacked into one bar per label (for example present, excused and missed). */
export function StackedBar(props: Props) {
  return <Bars {...props} stacked />;
}
