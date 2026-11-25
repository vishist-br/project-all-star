import { Skeleton } from "@/components/ui/Skeleton";
import { getT } from "@/lib/i18n/server";

/** Shape of the send screen while it loads: header, member list, settings. No layout shift when it arrives. */
export default async function Loading() {
  const { t } = await getT();
  return (
    <div role="status" aria-busy="true" aria-label={t("app.loading")} style={{ display: "grid", gap: 16, maxWidth: "42rem" }}>
      <div className="skeleton skel-title" aria-hidden="true" />
      <Skeleton kind="tile" />
      <Skeleton kind="table" rows={5} />
      <Skeleton kind="chart" />
    </div>
  );
}
