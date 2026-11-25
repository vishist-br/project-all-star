import { Skeleton } from "@/components/ui/Skeleton";
import { getT } from "@/lib/i18n/server";
import s from "@/components/exercise/exercise.module.css";

/** Same shape as the loaded page (back link, title, tabs, tiles, chart) so nothing jumps when it arrives. */
export default async function Loading() {
  const { t } = await getT();
  return (
    <div className={s.skeleton} role="status" aria-busy="true" aria-label={t("app.loading")}>
      <div className="skeleton skel-line" style={{ width: "30%", height: 24 }} aria-hidden="true" />
      <div className="skeleton skel-title" aria-hidden="true" />
      <div className="skeleton" style={{ height: 50 }} aria-hidden="true" />
      <div className={s.tiles}>
        <Skeleton kind="tile" />
        <Skeleton kind="tile" />
        <Skeleton kind="tile" />
      </div>
      <Skeleton kind="chart" />
    </div>
  );
}
