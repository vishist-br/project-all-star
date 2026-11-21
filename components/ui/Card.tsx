import type { ReactNode } from "react";
import { Sparkline } from "../charts/Sparkline";
import type { Num } from "../charts/scale";

/** Surface with an optional header (title + actions) and footer. */
export function Card({
  title,
  actions,
  footer,
  children,
  as: Tag = "section",
  className,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  as?: "section" | "div" | "li" | "article";
  className?: string;
}) {
  return (
    <Tag className={`card${className ? ` ${className}` : ""}`}>
      {(title || actions) && (
        <div className="card-head">
          {title && <h2 className="card-title">{title}</h2>}
          {actions && <div className="card-actions">{actions}</div>}
        </div>
      )}
      {children}
      {footer && <div className="card-foot">{footer}</div>}
    </Tag>
  );
}

/**
 * KPI tile. `change` is the difference vs the previous period (null hides it); an up arrow is
 * good news, a down arrow is shown neutrally (positive framing). `trend` draws a sparkline.
 */
export function StatTile({
  label,
  value,
  previous,
  change,
  changeLabel,
  trend,
  trendLabel,
}: {
  label: string;
  value: ReactNode;
  previous?: string;
  change?: number | null;
  changeLabel?: string;
  trend?: Num[];
  trendLabel?: string;
}) {
  const dir = change === undefined || change === null || change === 0 ? "flat" : change > 0 ? "up" : "down";
  return (
    <div className="stat-tile">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {(change !== undefined && change !== null) || previous ? (
        <span className={`stat-change stat-${dir}`}>
          {change !== undefined && change !== null && (
            <>
              <span aria-hidden="true">{dir === "up" ? "▲" : dir === "down" ? "▼" : "▬"}</span>{" "}
              <span>{changeLabel ?? `${change > 0 ? "+" : ""}${change}`}</span>
            </>
          )}
          {previous && <span className="muted"> {previous}</span>}
        </span>
      ) : null}
      {trend && trend.length > 1 && <Sparkline values={trend} ariaLabel={trendLabel ?? label} />}
    </div>
  );
}

/** Responsive grid for StatTiles (2 columns on phones, more on wide screens). */
export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="stat-grid">{children}</div>;
}
