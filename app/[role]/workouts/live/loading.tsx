import { Skeleton } from "@/components/ui/Skeleton";
import { getT } from "@/lib/i18n/server";

/** Shape of the live screen while it loads: header, progress, two exercise cards. No jump when it arrives. */
export default async function Loading() {
  const { t } = await getT();
  return (
    <div role="status" aria-busy="true" aria-label={t("lw.loading")} className="stack">
      <div className="skeleton skel-title" aria-hidden="true" />
      <Skeleton kind="tile" />
      <Skeleton kind="chart" />
      <Skeleton kind="chart" />
    </div>
  );
}
