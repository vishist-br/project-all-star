import { Skeleton } from "@/components/ui/Skeleton";
import { getT } from "@/lib/i18n/server";

export default async function Loading() {
  const { t } = await getT();
  return (
    <div role="status" aria-busy="true" aria-label={t("app.loading")}>
      <div className="skeleton skel-title" aria-hidden="true" />
      <div className="stat-grid">
        <Skeleton kind="tile" />
        <Skeleton kind="tile" />
      </div>
      <Skeleton kind="table" rows={3} />
    </div>
  );
}
