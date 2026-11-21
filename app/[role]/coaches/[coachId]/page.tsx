import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { BarChart } from "@/components/charts";
import { NotAllowed } from "@/components/NotAllowed";
import s from "@/components/owner/coaches/coaches.module.css";
import { barWidth, formatHours, groupAvailability, loadBand } from "@/components/owner/coaches/view-model";
import { formatNumber, formatPercent, shortDate, weekdayName } from "@/components/owner/dashboard/view-model";
import { Badge, ProgressBar } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { Card, StatGrid, StatTile } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { ErrorState } from "@/components/ui/States";
import { listBatches } from "@/lib/api/batches";
import { listCoachAvailability } from "@/lib/api/availability";
import { getCoachStats } from "@/lib/api/coaches";
import { listVenues } from "@/lib/api/venues";
import { listWorkoutPlans } from "@/lib/api/workout-plans";
import { ApiError } from "@/lib/auth/errors";
import { checkRole } from "@/lib/auth/guard";
import { getT } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n";
import { isRole } from "@/lib/nav";
import { getViewer } from "@/lib/viewer";

const LIMIT = () => new URLSearchParams({ limit: "100" });

async function optional<T>(run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch (err) {
    console.error("owner coach detail panel failed", err instanceof Error ? err.message : err);
    return fallback;
  }
}

/** Owner view of one coach: stats, 8-week chart, availability (read-only), batches and plans. */
export default async function CoachDetailPage({ params }: { params: Promise<{ role: string; coachId: string }> }) {
  const { role, coachId } = await params;
  if (!isRole(role)) notFound();
  const { t, locale } = await getT();
  const { principal, db } = await getViewer();
  if (principal.role !== "owner" || role !== "owner") return <NotAllowed role={principal.role} />;
  checkRole(principal, "getCoachStats");

  let stats: Awaited<ReturnType<typeof getCoachStats>>;
  try {
    stats = await getCoachStats(db, principal, coachId, new URLSearchParams());
  } catch (err) {
    if (err instanceof ApiError && err.code === "not_found") notFound();
    console.error("owner coach stats failed", err instanceof Error ? err.message : err);
    return (
      <>
        <PageHeader title={t("nav.coaches")} />
        <div className={s.errorBox}>
          <ErrorState title={t("cs.error.title")} message={t("od.error.text")} />
          <ButtonLink variant="secondary" href={`/owner/coaches/${encodeURIComponent(coachId)}`}>{t("od.error.retry")}</ButtonLink>
        </div>
      </>
    );
  }

  const [availability, venues, batches, plans] = await Promise.all([
    optional(() => listCoachAvailability(db, principal, coachId), { coachId, slots: [] }),
    optional(() => listVenues(db, principal, LIMIT()), { items: [], nextCursor: null }),
    optional(() => listBatches(db, principal, LIMIT()), { items: [], nextCursor: null }),
    optional(() => listWorkoutPlans(db, principal, LIMIT()), { items: [], nextCursor: null }),
  ]);
  const venueNames = new Map(venues.items.map((v) => [v.id, v.name]));
  const days = groupAvailability(availability.slots, venueNames);
  const myBatches = batches.items.filter((b) => b.coachIds.includes(coachId));
  const myPlans = plans.items.filter((p) => p.coachId === coachId && p.status !== "archived");

  const num = (n: number) => formatNumber(n, locale) ?? "0";
  const pctTile = (label: string, value: number | null): ReactNode => {
    const text = formatPercent(value, locale);
    return <StatTile label={label} value={text ?? <span className={s.na2}>{t("an.notEnough")}</span>} />;
  };
  const band = loadBand(stats.loadPercent);
  const loadText = formatPercent(stats.loadPercent, locale);
  const weeks = stats.weekly.map((w) => shortDate(w.weekStart, locale));
  const hasWeekly = stats.weekly.some((w) => w.scheduled > 0);

  return (
    <>
      <div className={s.back}>
        <ButtonLink variant="ghost" href="/owner/coaches">{`← ${t("oc.back")}`}</ButtonLink>
      </div>
      <PageHeader title={stats.coachName} subtitle={t("cs.subtitle", { from: shortDate(stats.from, locale), to: shortDate(stats.to, locale) })} />

      <section aria-labelledby="coach-stats" className={s.statsGrid}>
        <h2 id="coach-stats" className="sr-only">{t("cs.stats.title")}</h2>
        <StatGrid>
          <StatTile label={t("cs.sessions.scheduled")} value={num(stats.sessions.scheduled)} />
          <StatTile label={t("cs.sessions.completed")} value={num(stats.sessions.completed)} />
          <StatTile label={t("cs.sessions.unlogged")} value={num(stats.sessions.unlogged)} />
          {pctTile(t("cs.consistency"), stats.consistencyPercent)}
          {pctTile(t("cs.attendance"), stats.attendancePercent)}
          {pctTile(t("cs.adherence"), stats.workoutAdherencePercent)}
          <StatTile label={t("cs.goals")} value={num(stats.memberOutcomes.goalsAchieved)} />
          <StatTile label={t("cs.promotions")} value={num(stats.memberOutcomes.levelPromotions)} />
          <StatTile label={t("cs.availability")} value={t("cs.hours", { n: formatHours(stats.availabilityHoursPerWeek) })} />
          <StatTile label={t("cs.batches")} value={num(stats.batchCount)} />
          <StatTile label={t("cs.members")} value={num(stats.memberCount)} />
          {pctTile(t("cs.load"), stats.loadPercent)}
        </StatGrid>
      </section>

      <Card title={t("cs.load")}>
        <div className={s.load}>
          <div className={s.loadHead}>
            {band !== "unknown" ? <Badge tone={band === "full" ? "warn" : band === "balanced" ? "ok" : "info"}>{t(`oc.band.${band}` as MessageKey)}</Badge> : <span className={s.na}>{t("an.notEnough")}</span>}
            {loadText && <strong>{t("oc.load.value", { value: loadText })}</strong>}
          </div>
          <ProgressBar value={stats.loadPercent === null ? null : barWidth(stats.loadPercent)} label={t("cs.load")} />
        </div>
      </Card>

      <div className={s.layout}>
        <Card title={t("cs.chart.title")}>
          {hasWeekly ? (
            <BarChart
              labels={weeks}
              ariaLabel={t("cs.chart.aria")}
              series={[
                { name: t("an.series.scheduled"), values: stats.weekly.map((w) => w.scheduled), color: "var(--c2)" },
                { name: t("an.series.completed"), values: stats.weekly.map((w) => w.completed) },
              ]}
            />
          ) : (
            <p className={s.empty}>{t("an.chart.empty")}</p>
          )}
        </Card>

        <Card title={t("cs.avail.title")}>
          {days.length === 0 ? (
            <p className={s.empty}>{t("cs.avail.empty")}</p>
          ) : (
            <ul className={s.list}>
              {days.map((d) => (
                <li key={d.weekday} className={s.row}>
                  <span className={s.day}>{weekdayName(d.weekday, locale, "long")}</span>
                  <span className={s.slots}>
                    {d.slots.map((sl) => (
                      <Badge key={sl.id} tone="neutral">
                        {sl.start}–{sl.end}
                        {sl.venue ? ` ${t("cs.avail.at", { venue: sl.venue })}` : ""}
                      </Badge>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={t("cs.batches.title")}>
          {myBatches.length === 0 ? (
            <p className={s.empty}>{t("cs.batches.empty")}</p>
          ) : (
            <ul className={s.list}>
              {myBatches.map((b) => (
                <li key={b.id} className={s.row}>
                  <div className={s.rowMain}>
                    <strong>{b.name}</strong>
                    <span className={s.rowMeta}>{b.sportName} · {b.venueName}</span>
                  </div>
                  <Badge tone="info">{b.capacity ? `${b.memberCount} / ${b.capacity}` : num(b.memberCount)}</Badge>
                </li>
              ))}
            </ul>
          )}
          <p><Link href="/owner/batches">{t("nav.batches")}</Link></p>
        </Card>

        <Card title={t("cs.plans.title")}>
          {myPlans.length === 0 ? (
            <p className={s.empty}>{t("cs.plans.empty")}</p>
          ) : (
            <ul className={s.list}>
              {myPlans.map((p) => (
                <li key={p.id} className={s.row}>
                  <div className={s.rowMain}>
                    <strong>{p.title}</strong>
                    <span className={s.rowMeta}>{t("cs.plans.row", { days: p.dayCount, items: p.itemCount, n: p.activeAssignmentCount })}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
