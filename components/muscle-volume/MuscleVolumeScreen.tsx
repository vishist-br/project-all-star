import Link from "next/link";
import { ChildSwitcher } from "@/components/customer/ChildSwitcher";
import { NoMember } from "@/components/customer/NoMember";
import s from "@/components/body-measurements/body.module.css";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { getMuscleVolume } from "@/lib/api/muscle-volume";
import { allow, getCustomerContext } from "@/lib/customer/server";
import { getT } from "@/lib/i18n/server";
import { MUSCLE_RANGES, type MuscleRange } from "@/lib/workouts/muscle-volume";
import { MuscleBars } from "./MuscleBars";

type Search = Record<string, string | string[] | undefined>;

/** Customer: every muscle with its sets (and weight lifted) for the chosen range. Empty state when no gym sets are logged. */
export async function MuscleVolumeScreen({ searchParams }: { searchParams: Search }) {
  const { t } = await getT();
  const ctx = await getCustomerContext();
  if (!ctx.selected) return <NoMember />;
  const { principal, db, selected } = ctx;
  allow(principal, "getMuscleVolume");
  const asked = typeof searchParams.range === "string" ? searchParams.range : "";
  const range: MuscleRange = (MUSCLE_RANGES as readonly string[]).includes(asked) ? (asked as MuscleRange) : "7d";
  const data = await getMuscleVolume(db, principal, selected.id, new URLSearchParams({ range }));

  return (
    <div className={s.stack}>
      <Link href="/customer/progress" className={s.back}>
        <span aria-hidden="true">←</span>
        {t("gx.mv.back")}
      </Link>
      <PageHeader title={t("gx.mv.title")} subtitle={t("gx.mv.subtitle")} />
      <ChildSwitcher members={ctx.children} selectedId={selected.id} />
      <ul className={s.chips} aria-label={t("gx.mv.rangeLabel")}>
        {MUSCLE_RANGES.map((r) => (
          <li key={r}>
            <Link href={`?range=${r}`} className={s.chip} aria-current={r === range ? "true" : undefined} data-testid={`range-${r}`} scroll={false}>
              {t(r === "7d" ? "gx.mv.range7" : "gx.mv.range28")}
            </Link>
          </li>
        ))}
      </ul>
      {!data.hasGymData ? (
        <EmptyState
          title={t("gx.mv.empty.title")}
          text={t("gx.mv.empty.text")}
          icon="◔"
          action={<Link className="btn btn-secondary" href="/customer/workouts">{t("nav.workouts")}</Link>}
        />
      ) : data.muscles.length === 0 ? (
        <EmptyState title={t("gx.mv.emptyRange.title")} text={t("gx.mv.emptyRange.text")} icon="◔" />
      ) : (
        <Card title={range === "7d" ? t("gx.mv.cardWeek") : t("gx.mv.card28")}>
          <MuscleBars rows={data.muscles} t={t} detail weeks={data.weeks} />
          <p className={s.meta} data-testid="muscle-total">{t("gx.mv.total", { sets: data.totalSets, volume: Math.round(data.totalVolumeKg) })}</p>
        </Card>
      )}
    </div>
  );
}
