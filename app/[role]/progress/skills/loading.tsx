import { Skeleton } from "@/components/ui/Skeleton";
import { getT } from "@/lib/i18n/server";

export default async function Loading() {
  const { t } = await getT();
  return (
    <div role="status" aria-busy="true" aria-label={t("app.loading")}>
      <div className="skeleton skel-title" aria-hidden="true" />
      <Skeleton kind="chart" />
      <Skeleton kind="table" rows={4} />
    </div>
  );
}
