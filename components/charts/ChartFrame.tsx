import type { ReactNode } from "react";
import { fmt, seriesColor, type Num } from "./scale";

export type Series = { name: string; values: Num[]; color?: string };

/**
 * Shared wrapper: an SVG with role="img" and an aria-label summary, plus a visually hidden table
 * with the same numbers (the SVG itself is opaque to screen readers) and a legend when > 1 series.
 */
export function ChartFrame({
  ariaLabel,
  viewBox,
  children,
  legend,
  table,
  className,
}: {
  ariaLabel: string;
  viewBox: string;
  children: ReactNode;
  legend?: { name: string; color: string }[];
  table: { corner?: string; columns: string[]; rows: { label: string; values: Num[] }[] };
  className?: string;
}) {
  return (
    <figure className={`chart${className ? ` ${className}` : ""}`}>
      <svg role="img" aria-label={ariaLabel} viewBox={viewBox} className="chart-svg" preserveAspectRatio="xMidYMid meet">
        {children}
      </svg>
      {legend && legend.length > 1 && (
        <ul className="chart-legend">
          {legend.map((l) => (
            <li key={l.name}>
              <span className="chart-swatch" style={{ background: l.color }} aria-hidden="true" />
              {l.name}
            </li>
          ))}
        </ul>
      )}
      <div className="sr-only">
        <table>
          <caption>{ariaLabel}</caption>
          <thead>
            <tr>
              <th scope="col">{table.corner ?? ""}</th>
              {table.columns.map((c) => (
                <th key={c} scope="col">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r) => (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                {r.values.map((v, i) => (
                  <td key={i}>{fmt(v)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

export function legendOf(series: Series[]) {
  return series.map((s, i) => ({ name: s.name, color: seriesColor(i, s.color) }));
}
