import type { Point } from "@/lib/exercise/metrics";
import { niceTicks, xFractions } from "@/lib/exercise/scale";

const W = 320;
const H = 200;
const PAD = { l: 38, r: 16, t: 30, b: 26 };
const PW = W - PAD.l - PAD.r;
const PH = H - PAD.t - PAD.b;
const r1 = (n: number) => Math.round(n * 10) / 10;

export type ChartLabels = {
  aria: string;
  tableCaption: string;
  colDate: string;
  colValue: string;
  newBest: string;
};

/**
 * Line chart of one metric over time: a 2px line, an end dot with its value as a direct label, a quiet
 * grid, first and last date on the x axis and a ring on the newest "new best". The y axis does not start
 * at zero (the tick labels show the range). A hidden table carries the same numbers for screen readers.
 */
export function ProgressChart({
  points,
  newBestDate,
  formatAxis,
  formatValue,
  formatDate,
  labels,
}: {
  points: Point[];
  newBestDate: string | null;
  formatAxis: (v: number) => string;
  formatValue: (v: number) => string;
  formatDate: (d: string) => string;
  labels: ChartLabels;
}) {
  const values = points.map((p) => p.value);
  const { lo, hi, ticks } = niceTicks(Math.min(...values), Math.max(...values));
  const yAt = (v: number) => r1(PAD.t + PH - ((v - lo) / (hi - lo)) * PH);
  const xs = xFractions(points.map((p) => p.date)).map((f) => r1(PAD.l + f * PW));
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${xs[i]} ${yAt(p.value)}`).join(" ");
  const last = points.length - 1;
  const endX = xs[last]!;
  const endY = yAt(points[last]!.value);
  const nb = newBestDate ? points.findIndex((p) => p.date === newBestDate) : -1;

  return (
    <figure className="chart xp-chart" data-testid="exercise-chart">
      <svg role="img" aria-label={labels.aria} viewBox={`0 0 ${W} ${H}`} className="chart-svg" preserveAspectRatio="xMidYMid meet">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={yAt(v)} y2={yAt(v)} className="chart-grid" />
            <text x={PAD.l - 5} y={yAt(v) + 3.5} textAnchor="end" className="chart-text">{formatAxis(v)}</text>
          </g>
        ))}
        <text x={PAD.l} y={H - 6} textAnchor="start" className="chart-text">{formatDate(points[0]!.date)}</text>
        {points.length > 1 && <text x={W - PAD.r} y={H - 6} textAnchor="end" className="chart-text">{formatDate(points[last]!.date)}</text>}
        {points.length > 1 && <path d={d} className="chart-line" stroke="var(--primary-text)" />}
        {points.map((p, i) =>
          i === last ? null : (
            <circle key={p.date + i} cx={xs[i]} cy={yAt(p.value)} r={points.length > 24 ? 2 : 3.5} fill="var(--primary-text)" stroke="var(--card)" strokeWidth={1.5}>
              <title>{`${formatDate(p.date)}: ${formatValue(p.value)}`}</title>
            </circle>
          ),
        )}
        {nb >= 0 && nb !== last && <circle cx={xs[nb]} cy={yAt(points[nb]!.value)} r={7} fill="none" stroke="var(--ok)" strokeWidth={2} />}
        <circle cx={endX} cy={endY} r={5.5} fill="var(--primary-text)" stroke="var(--card)" strokeWidth={2}>
          <title>{`${formatDate(points[last]!.date)}: ${formatValue(points[last]!.value)}`}</title>
        </circle>
        {nb === last && <circle cx={endX} cy={endY} r={9} fill="none" stroke="var(--ok)" strokeWidth={2} />}
        <text x={endX} y={Math.max(12, endY - 13)} textAnchor={endX > W - 60 ? "end" : "middle"} fontSize={12} fontWeight={700} fill="var(--fg)">{formatValue(points[last]!.value)}</text>
      </svg>
      <div className="sr-only">
        <table>
          <caption>{labels.tableCaption}</caption>
          <thead>
            <tr>
              <th scope="col">{labels.colDate}</th>
              <th scope="col">{labels.colValue}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.date}>
                <th scope="row">{formatDate(p.date)}</th>
                <td>{formatValue(p.value)}{p.date === newBestDate ? `, ${labels.newBest}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
