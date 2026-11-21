/** Loading placeholders. The wrapper announces "busy" once; the shapes are decorative. */
export function Skeleton({ kind = "line", rows = 3 }: { kind?: "line" | "tile" | "chart" | "table"; rows?: number }) {
  if (kind === "tile") return <div className="skeleton skel-tile" aria-hidden="true" />;
  if (kind === "chart") return <div className="skeleton skel-chart" aria-hidden="true" />;
  if (kind === "table")
    return (
      <div className="skel-table" aria-hidden="true">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="skeleton skel-row" />
        ))}
      </div>
    );
  return <div className="skeleton skel-line" aria-hidden="true" />;
}

/** A whole-page skeleton: title, a row of tiles, a chart and a table. Used by loading.tsx. */
export function PageSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label}>
      <div className="skeleton skel-title" aria-hidden="true" />
      <div className="stat-grid">
        <Skeleton kind="tile" />
        <Skeleton kind="tile" />
        <Skeleton kind="tile" />
        <Skeleton kind="tile" />
      </div>
      <Skeleton kind="chart" />
      <Skeleton kind="table" rows={4} />
    </div>
  );
}
