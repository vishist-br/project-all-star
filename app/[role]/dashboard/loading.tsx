import { getT } from "@/lib/i18n/server";
import { Skeleton } from "@/components/ui/Skeleton";

/** Dashboard skeleton: header, range chips, KPI tiles, then chart placeholders. */
export default async function DashboardLoading() {
  const { t } = await getT();
  return (
    <div role="status" aria-busy="true" aria-label={t("app.loading")}>
      <div className="skeleton skel-title" aria-hidden="true" />
      <div className="stat-grid">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} kind="tile" />
        ))}
      </div>
      <Skeleton kind="chart" />
      <Skeleton kind="chart" />
      <Skeleton kind="table" rows={4} />
    </div>
  );
}
