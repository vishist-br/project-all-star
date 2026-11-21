import { fmt, ticks } from "./scale";

export const W = 320;
export const H = 180;
export const PAD = { l: 30, r: 8, t: 8, b: 22 };
export const PLOT_W = W - PAD.l - PAD.r;
export const PLOT_H = H - PAD.t - PAD.b;

export const yAt = (v: number, axisMax: number) => PAD.t + PLOT_H - (v / axisMax) * PLOT_H;

/** Gridlines with y labels (max 5) and x labels thinned so they never overlap. */
export function Axes({ axisMax, labels, xAt, unit }: { axisMax: number; labels: string[]; xAt: (i: number) => number; unit?: string }) {
  const every = Math.max(1, Math.ceil(labels.length / 6));
  return (
    <g>
      {ticks(axisMax).map((t) => (
        <g key={t}>
          <line x1={PAD.l} x2={W - PAD.r} y1={yAt(t, axisMax)} y2={yAt(t, axisMax)} className="chart-grid" />
          <text x={PAD.l - 4} y={yAt(t, axisMax) + 3} textAnchor="end" className="chart-text">
            {fmt(t)}{unit ?? ""}
          </text>
        </g>
      ))}
      {labels.map((l, i) =>
        i % every === 0 ? (
          <text key={i} x={xAt(i)} y={H - 6} textAnchor="middle" className="chart-text">{l}</text>
        ) : null,
      )}
    </g>
  );
}
