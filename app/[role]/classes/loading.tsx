import { Skeleton } from "@/components/ui/Skeleton";
import { getT } from "@/lib/i18n/server";

/** Class summaries while loading: title, then two card-shaped placeholders (same height as a real card). */
export default async function Loading() {
  const { t } = await getT();
  return (
    <div role="status" aria-busy="true" aria-label={t("app.loading")} style={{ display: "grid", gap: 16 }}>
      <div className="skeleton skel-title" aria-hidden="true" />
      <Skeleton kind="chart" />
      <Skeleton kind="chart" />
    </div>
  );
}
