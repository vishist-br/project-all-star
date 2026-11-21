import { Axes, PAD, PLOT_W, W, H, yAt } from "./Axes";
import { ChartFrame, legendOf, type Series } from "./ChartFrame";
import { fmt, linePath, maxOf, niceMax, runs, seriesColor } from "./scale";

/** 1 to 3 series over shared labels. Axis starts at 0; `percent` fixes it to 0-100. Nulls are gaps. */
export function LineChart({
  labels,
  series,
  ariaLabel,
  area,
  percent,
  unit,
}: {
  labels: string[];
  series: Series[];
  ariaLabel: string;
  area?: boolean;
  percent?: boolean;
  unit?: string;
}) {
  const shown = series.slice(0, 3);
  const axisMax = percent ? 100 : niceMax(maxOf(shown.map((s) => s.values)));
  const xAt = (i: number) => PAD.l + (labels.length <= 1 ? PLOT_W / 2 : (i / (labels.length - 1)) * PLOT_W);
  return (
    <ChartFrame
      ariaLabel={ariaLabel}
      viewBox={`0 0 ${W} ${H}`}
      legend={legendOf(shown)}
      table={{ columns: shown.map((s) => s.name), rows: labels.map((l, i) => ({ label: l, values: shown.map((s) => s.values[i] ?? null) })) }}
    >
      <Axes axisMax={axisMax} labels={labels} xAt={xAt} unit={percent ? "%" : unit} />
      {shown.map((s, si) => {
        const color = seriesColor(si, s.color);
        const pieces = runs(s.values.map((v, i) => ({ x: xAt(i), y: v === null ? null : yAt(v, axisMax) })));
        return (
          <g key={s.name}>
            {area &&
              pieces.map((r, i) => (
                <path key={`a${i}`} className="chart-area" fill={color} d={`${linePath(r)} L${r[r.length - 1].x.toFixed(1)} ${yAt(0, axisMax)} L${r[0].x.toFixed(1)} ${yAt(0, axisMax)} Z`} />
              ))}
            {pieces.map((r, i) => (
              <path key={`l${i}`} className="chart-line" stroke={color} d={linePath(r)} />
            ))}
            {s.values.map((v, i) =>
              v === null ? null : (
                <circle key={i} cx={xAt(i)} cy={yAt(v, axisMax)} r={labels.length > 16 ? 1.8 : 3} fill={color}>
                  <title>{`${s.name}, ${labels[i]}: ${fmt(v)}`}</title>
                </circle>
              ),
            )}
          </g>
        );
      })}
    </ChartFrame>
  );
}
