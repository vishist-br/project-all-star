import Link from "next/link";
import { listBodyMeasurements } from "@/lib/api/body-measurements";
import { ProgressChart } from "@/components/exercise/ProgressChart";
import { ChildSwitcher } from "@/components/customer/ChildSwitcher";
import { NoMember } from "@/components/customer/NoMember";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { getCustomerContext, allow } from "@/lib/customer/server";
import { shortDay } from "@/lib/exercise/metrics";
import {
  BODY_METRICS,
  UNIT_KEY,
  availableMetrics,
  deltaText,
  isBodyMetric,
  numText,
  pointsFor,
  type BodyMetricKey,
  type MeasurementLike,
} from "@/lib/gym-extras/view";
import { getT } from "@/lib/i18n/server";
import { DeleteEntry } from "./DeleteEntry";
import { MeasurementForm } from "./MeasurementForm";
import s from "./body.module.css";

type Search = Record<string, string | string[] | undefined>;

/**
 * Customer: body measurements of the selected member. Latest values, an add form, a trend line per
 * measurement (chips choose which one, kept in the URL) and the history with delete.
 * Positive framing: numbers are shown as they are, with no verdict.
 */
export async function BodyMeasurementsScreen({ searchParams }: { searchParams: Search }) {
  const { t, locale } = await getT();
  const ctx = await getCustomerContext();
  if (!ctx.selected) return <NoMember />;
  const { principal, db, today, selected } = ctx;
  allow(principal, "listBodyMeasurements");

  const data = await listBodyMeasurements(db, principal, selected.id, new URLSearchParams());
  const items = data.items as unknown as MeasurementLike[];
  const latest = data.latest as unknown as (MeasurementLike & { measuredOn: string }) | null;
  const first = items[0] ?? null;

  const offered = availableMetrics(items);
  const asked = typeof searchParams.m === "string" ? searchParams.m : "";
  const metric: BodyMetricKey = isBodyMetric(asked) && offered.includes(asked) ? asked : "weightKg";
  const meta = BODY_METRICS.find((m) => m.key === metric)!;
  const metricName = t(meta.label);
  const valueText = (v: number) => t(UNIT_KEY[meta.unit], { n: numText(v) });
  const points = pointsFor(items, metric);
  const dayText = (d: string) => shortDay(d, locale);
  const rowText = (i: MeasurementLike) =>
    BODY_METRICS.filter((m) => i[m.key] !== null)
      .map((m) => `${t(m.label)} ${t(UNIT_KEY[m.unit], { n: numText(i[m.key] as number) })}`)
      .join(" · ");

  return (
    <div className={s.stack}>
      <Link href="/customer/progress" className={s.back}>
        <span aria-hidden="true">←</span>
        {t("gx.bm.back")}
      </Link>
      <PageHeader title={t("gx.bm.title")} subtitle={selected.isOwn ? t("gx.bm.subtitle") : t("gx.bm.subtitle.child", { name: selected.name })} />
      <ChildSwitcher members={ctx.children} selectedId={selected.id} />

      {latest && (
        <Card title={t("gx.bm.latest")}>
          <div className={s.tiles} data-testid="latest-values">
            {BODY_METRICS.filter((m) => latest[m.key] !== null).map((m) => (
              <div key={m.key} className={s.tile}>
                <span className={s.tileLabel}>{t(m.label)}</span>
                <span className={s.tileValue} data-testid={`latest-${m.key}`}>{t(UNIT_KEY[m.unit], { n: numText(latest[m.key] as number) })}</span>
                {m.key === "weightKg" && first && first.id !== latest.id && first.weightKg !== null && (
                  <span className={s.tileSub}>{t("gx.bm.sinceFirst", { delta: deltaText(first.weightKg, latest.weightKg as number), date: dayText(first.measuredOn) })}</span>
                )}
              </div>
            ))}
          </div>
          <p className={s.meta}>{t("gx.bm.latestOn", { date: dayText(latest.measuredOn) })}</p>
        </Card>
      )}

      <Card title={t("gx.bm.add")}>
        <MeasurementForm memberId={selected.id} today={today} />
      </Card>

      {items.length === 0 ? (
        <EmptyState title={t("gx.bm.empty.title")} text={t("gx.bm.empty.text")} icon="↗" />
      ) : (
        <>
          <Card title={t("gx.bm.trend")}>
            <ul className={s.chips} aria-label={t("gx.bm.chips")}>
              {offered.map((k) => {
                const m = BODY_METRICS.find((x) => x.key === k)!;
                return (
                  <li key={k}>
                    <Link href={`?m=${k}`} className={s.chip} aria-current={k === metric ? "true" : undefined} data-testid={`chip-${k}`} scroll={false}>
                      {t(m.label)}
                    </Link>
                  </li>
                );
              })}
            </ul>
            {points.length === 0 ? (
              <p className="muted">{t("gx.bm.chartNoData")}</p>
            ) : (
              <div data-testid="body-chart" data-points={points.length}>
                <ProgressChart
                  points={points}
                  newBestDate={null}
                  formatAxis={(v) => numText(v)}
                  formatValue={valueText}
                  formatDate={dayText}
                  labels={{
                    aria: t("gx.bm.chartAria", { metric: metricName }),
                    tableCaption: t("gx.bm.chartTable", { metric: metricName }),
                    colDate: t("gx.bm.colDate"),
                    colValue: t("gx.bm.colValue"),
                    newBest: "",
                  }}
                />
              </div>
            )}
          </Card>

          <Card title={t("gx.bm.history")}>
            <ul className={s.history} data-testid="measurement-history">
              {[...items].reverse().map((i) => (
                <li key={i.id} className={s.entry} data-testid="measurement-entry">
                  <div className={s.entryText}>
                    <span className={s.entryDate}>{dayText(i.measuredOn)}</span>
                    <span className={s.entryNums}>{rowText(i)}</span>
                    {i.note && <span className={s.entryNote}>{i.note}</span>}
                  </div>
                  <DeleteEntry memberId={selected.id} measurementId={i.id} dateLabel={dayText(i.measuredOn)} />
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
