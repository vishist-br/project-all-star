import Link from "next/link";
import type { ReactNode } from "react";
import type { getCoachWorkload, getFeeStats, getOwnerInsights, getOwnerOverview, getOwnerTrends } from "@/lib/api/analytics";
import { BarChart, Donut, LineChart, ProgressRing, WeekdayHeatmap } from "@/components/charts";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { Card, StatGrid, StatTile } from "@/components/ui/Card";
import { Segmented } from "@/components/ui/Tabs";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { PageHeader } from "@/components/ui/PageHeader";
import type { Locale, MessageKey, Params } from "@/lib/i18n";
import s from "./dashboard.module.css";
import {
  RANGES,
  cardView,
  feeSlices,
  followUpReason,
  formatNumber,
  formatPercent,
  hasSignal,
  monthLabel,
  ratioText,
  shortDate,
  tileFrom,
  weekdayName,
  type RangeDays,
  type TileModel,
} from "./view-model";

export type Settled<T> = { ok: true; data: T } | { ok: false };
type Translate = (key: MessageKey, params?: Params) => string;

export type DashboardData = {
  days: RangeDays;
  from: string;
  to: string;
  overview: Settled<Awaited<ReturnType<typeof getOwnerOverview>>>;
  trends: Settled<Awaited<ReturnType<typeof getOwnerTrends>>>;
  fees: Settled<Awaited<ReturnType<typeof getFeeStats>>>;
  insights: Settled<Awaited<ReturnType<typeof getOwnerInsights>>>;
  workload: Settled<Awaited<ReturnType<typeof getCoachWorkload>>>;
};

/** A panel that failed to load: friendly message and a link that reloads this page. */
function PanelError({ t, days }: { t: Translate; days: RangeDays }) {
  return (
    <div className={s.errorBox}>
      <ErrorState title={t("od.error.title")} message={t("od.error.text")} />
      <ButtonLink variant="secondary" href={`?range=${days}`}>{t("od.error.retry")}</ButtonLink>
    </div>
  );
}

function NotEnough({ t }: { t: Translate }) {
  return <p className={s.empty}>{t("an.chart.empty")}</p>;
}

function Tile({ t, label, model, valueText, trend, trendLabel }: { t: Translate; label: string; model: TileModel; valueText?: string | null; trend?: (number | null)[]; trendLabel?: string }) {
  const shown = valueText === undefined ? model.value : valueText;
  return (
    <StatTile
      label={label}
      value={shown === null ? <span className={s.na}>{t("an.notEnough")}</span> : shown}
      previous={shown !== null && model.previous !== null ? t("an.kpi.previous", { value: model.previous }) : undefined}
      change={shown !== null ? model.change : null}
      changeLabel={model.changeText ? t("an.kpi.change", { change: model.changeText }) : undefined}
      trend={shown !== null ? trend : undefined}
      trendLabel={trendLabel}
    />
  );
}

export function DashboardContent({ data, t, locale }: { data: DashboardData; t: Translate; locale: Locale }) {
  const { days, overview, trends, fees, insights, workload } = data;
  const o = overview.ok ? overview.data : null;
  const weeks = trends.ok ? trends.data.points.length : 0;
  const pts = trends.ok ? trends.data.points : [];
  const labels = pts.map((p) => shortDate(p.periodStart, locale));
  const trendOf = (pick: (p: (typeof pts)[number]) => number | null) => pts.map(pick);

  const range = (
    <div className={s.range}>
    <Segmented
      label={t("od.range.label")}
      items={RANGES.map((r) => ({ href: `?range=${r}`, label: t(`od.range.${r}` as MessageKey), active: r === days }))}
    />
    </div>
  );
  const quick = (
    <nav className={s.quick} aria-label={t("od.quick.label")}>
      <ButtonLink variant="secondary" href="/owner/plans">{t("od.quick.plans")}</ButtonLink>
      <ButtonLink variant="secondary" href="/owner/coaches">{t("od.quick.coaches")}</ButtonLink>
      <ButtonLink variant="secondary" href="/owner/members">{t("od.quick.members")}</ButtonLink>
    </nav>
  );
  const header = (
    <>
      <PageHeader title={t("nav.dashboard")} subtitle={t("od.subtitle", { from: shortDate(data.from, locale), to: shortDate(data.to, locale) })} />
      <div className={s.toolbar}>
        {range}
        {quick}
      </div>
    </>
  );

  if (!o) {
    return (
      <>
        {header}
        <PanelError t={t} days={days} />
      </>
    );
  }

  const brandNew = o.members.active.value === 0 && o.sessions.scheduled.value === 0;
  if (brandNew) {
    return (
      <>
        {header}
        <EmptyState title={t("od.empty.title")} text={t("od.empty.text")} action={<ButtonLink href="/owner/members/import">{t("od.empty.action")}</ButtonLink>} />
      </>
    );
  }

  const tile = (key: string, k: Parameters<typeof tileFrom>[1], unit: "count" | "percent") => tileFrom(key, k, unit, locale);
  const weeklyTrend = (label: string) => t("an.kpi.trend", { label });
  const sessionsTile = tile("sessions", o.sessions.completed, "count");

  return (
    <>
      {header}

      <section aria-labelledby="kpis">
        <h2 id="kpis" className="sr-only">{t("an.section.kpis")}</h2>
        <StatGrid>
          <Tile t={t} label={t("an.kpi.activeMembers")} model={tile("active", o.members.active, "count")} trend={trendOf((p) => p.activeMembers)} trendLabel={weeklyTrend(t("an.kpi.activeMembers"))} />
          <Tile t={t} label={t("an.kpi.attendance")} model={tile("attendance", o.attendance.percent, "percent")} trend={trendOf((p) => p.attendancePercent)} trendLabel={weeklyTrend(t("an.kpi.attendance"))} />
          <Tile t={t} label={t("an.kpi.noShow")} model={tile("noshow", o.attendance.noShowPercent, "percent")} />
          <Tile
            t={t}
            label={t("an.kpi.sessions")}
            model={sessionsTile}
            valueText={o.sessions.scheduled.value ? ratioText(o.sessions.completed.value, o.sessions.scheduled.value, t, locale) : null}
          />
          <Tile t={t} label={t("an.kpi.newMembers")} model={tile("new", o.members.new, "count")} />
          <Tile t={t} label={t("an.kpi.retention")} model={tile("retention", o.retention.percent, "percent")} />
          <Tile t={t} label={t("an.kpi.adherence")} model={tile("adherence", o.workouts.adherencePercent, "percent")} />
          <Tile t={t} label={t("an.kpi.engagement")} model={tile("engagement", o.engagement.percent, "percent")} trend={trendOf((p) => p.engagedMembers)} trendLabel={weeklyTrend(t("an.kpi.engagement"))} />
        </StatGrid>
      </section>

      <section className={s.section} aria-labelledby="insights-h">
        <h2 id="insights-h">{t("insights.title")}</h2>
        {!insights.ok ? (
          <PanelError t={t} days={days} />
        ) : (
          <InsightCards cards={insights.data.cards} t={t} locale={locale} />
        )}
      </section>

      <div className={s.layout}>
        <div className={s.main}>
          <section className={s.section} aria-labelledby="trends-h">
            <h2 id="trends-h">{t("an.section.trends", { weeks })}</h2>
            {!trends.ok ? (
              <PanelError t={t} days={days} />
            ) : (
              <div className={s.chartGrid}>
                <Card title={t("an.chart.members.title")}>
                  <LineChart
                    labels={labels}
                    ariaLabel={t("an.chart.members.aria", { weeks })}
                    series={[{ name: t("an.series.active"), values: trendOf((p) => p.activeMembers) }]}
                    area
                  />
                </Card>
                <Card title={t("an.chart.joinLeave.title")}>
                  <BarChart
                    labels={labels}
                    ariaLabel={t("an.chart.joinLeave.aria", { weeks })}
                    series={[
                      { name: t("an.series.new"), values: trendOf((p) => p.newMembers) },
                      { name: t("an.series.left"), values: trendOf((p) => p.leftMembers), color: "var(--c2)" },
                    ]}
                  />
                </Card>
                <Card title={t("an.chart.sessions.title")}>
                  <BarChart
                    labels={labels}
                    ariaLabel={t("an.chart.sessions.aria", { weeks })}
                    series={[
                      { name: t("an.series.scheduled"), values: trendOf((p) => p.sessionsScheduled), color: "var(--c2)" },
                      { name: t("an.series.completed"), values: trendOf((p) => p.sessionsCompleted) },
                    ]}
                  />
                </Card>
                <Card title={t("an.chart.attendance.title")}>
                  {hasSignal(trendOf((p) => p.attendancePercent)) ? (
                    <LineChart
                      labels={labels}
                      ariaLabel={t("an.chart.attendance.aria", { weeks })}
                      series={[{ name: t("an.series.attendance"), values: trendOf((p) => p.attendancePercent) }]}
                      percent
                    />
                  ) : (
                    <NotEnough t={t} />
                  )}
                </Card>
                <Card title={t("an.chart.workouts.title")}>
                  {hasSignal(trendOf((p) => p.workoutsScheduled)) ? (
                    <BarChart
                      labels={labels}
                      ariaLabel={t("an.chart.workouts.aria", { weeks })}
                      series={[
                        { name: t("an.series.scheduled"), values: trendOf((p) => p.workoutsScheduled), color: "var(--c2)" },
                        { name: t("an.series.completed"), values: trendOf((p) => p.workoutsCompleted) },
                      ]}
                    />
                  ) : (
                    <NotEnough t={t} />
                  )}
                </Card>
                <Card title={t("an.chart.engagement.title")}>
                  <LineChart
                    labels={labels}
                    ariaLabel={t("an.chart.engagement.aria", { weeks })}
                    series={[{ name: t("an.series.engaged"), values: trendOf((p) => p.engagedMembers) }]}
                  />
                </Card>
              </div>
            )}
          </section>

          <section className={s.section} aria-labelledby="patterns-h">
            <h2 id="patterns-h">{t("an.section.patterns")}</h2>
            <div className={s.chartGrid}>
              <Card title={t("an.chart.weekday.title")}>
                {hasSignal(o.attendance.byWeekday.map((w) => w.sessions)) ? (
                  <WeekdayHeatmap
                    labels={o.attendance.byWeekday.map((w) => weekdayName(w.weekday, locale))}
                    values={o.attendance.byWeekday.map((w) => w.percent)}
                    ariaLabel={t("an.chart.weekday.aria")}
                    valueLabel={t("an.series.attendance")}
                  />
                ) : (
                  <NotEnough t={t} />
                )}
              </Card>
              <Card title={t("an.chart.noshowWeekday.title")}>
                {hasSignal(o.attendance.byWeekday.map((w) => w.sessions)) ? (
                  <WeekdayHeatmap
                    labels={o.attendance.byWeekday.map((w) => weekdayName(w.weekday, locale))}
                    values={o.attendance.byWeekday.map((w) => w.noShowPercent)}
                    ariaLabel={t("an.chart.noshowWeekday.aria")}
                    valueLabel={t("an.chart.noshowWeekday.value")}
                  />
                ) : (
                  <NotEnough t={t} />
                )}
              </Card>
              <Card title={t("an.chart.batch.title")} className={s.wide}>
                <BatchTable batches={o.attendance.byBatch} t={t} locale={locale} />
              </Card>
              <Card title={t("an.chart.cohorts.title")} className={s.wide}>
                <p className={s.hint}>{t("an.chart.cohorts.hint")}</p>
                <CohortTable cohorts={o.retention.cohorts} t={t} locale={locale} />
              </Card>
            </div>
          </section>

          <section className={s.section} aria-labelledby="people-h">
            <h2 id="people-h">{t("an.section.coaches")}</h2>
            <div className={s.chartGrid}>
              <Card title={t("an.bookings.title")}>
                <Bookings bookings={o.bookings} t={t} locale={locale} />
              </Card>
              <Card title={t("an.fees.title")}>
                {!fees.ok ? <PanelError t={t} days={days} /> : <FeePanel fees={fees.data} t={t} locale={locale} />}
              </Card>
              <Card
                title={t("an.coaches.title")}
                footer={<Link href="/owner/coaches">{t("an.coaches.all")}</Link>}
              >
                {!workload.ok ? <PanelError t={t} days={days} /> : <CoachSnippet items={workload.data.items} t={t} locale={locale} />}
              </Card>
            </div>
          </section>
        </div>

        <aside className={s.aside} aria-label={t("an.section.members")}>
          {!insights.ok ? (
            <Card title={t("an.followups.title")}>
              <PanelError t={t} days={days} />
            </Card>
          ) : (
            <>
              <FollowUps items={insights.data.followUps} t={t} locale={locale} />
              <Renewals items={insights.data.renewals} t={t} locale={locale} />
              <Unlogged items={insights.data.unloggedSessions} t={t} locale={locale} />
            </>
          )}
        </aside>
      </div>
    </>
  );
}

type Insights = Awaited<ReturnType<typeof getOwnerInsights>>;
type Overview = Awaited<ReturnType<typeof getOwnerOverview>>;

function InsightCards({ cards, t, locale }: { cards: Insights["cards"]; t: Translate; locale: Locale }) {
  const views = cards.map((c) => cardView(c, t, locale)).filter((c): c is NonNullable<typeof c> => c !== null);
  if (views.length === 0) return <p className={s.empty}>{t("insights.empty")}</p>;
  return (
    <ul className={s.cards} aria-label={t("insights.title")}>
      {views.map((c) => (
        <li key={c.code} className={`${s.insight} ${s[c.tone]}`} data-card={c.code}>
          {c.text}
        </li>
      ))}
    </ul>
  );
}

function BatchTable({ batches, t, locale }: { batches: Overview["attendance"]["byBatch"]; t: Translate; locale: Locale }) {
  if (batches.length === 0) return <p className={s.empty}>{t("an.chart.batch.empty")}</p>;
  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <caption className="sr-only">{t("an.chart.batch.title")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("data.batch")}</th>
            <th scope="col">{t("an.chart.batch.sessions")}</th>
            <th scope="col">{t("an.kpi.attendance")}</th>
            <th scope="col">{t("an.kpi.noShow")}</th>
          </tr>
        </thead>
        <tbody>
          {batches.map((b) => (
            <tr key={b.batchId}>
              <th scope="row">{b.batchName}</th>
              <td className={s.cell}>{formatNumber(b.sessions, locale)}</td>
              <PercentCell value={b.percent} t={t} locale={locale} />
              <PercentCell value={b.noShowPercent} t={t} locale={locale} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A null percentage is a dash with a screen-reader explanation, never 0%. */
function PercentCell({ value, t, locale, tint }: { value: number | null; t: Translate; locale: Locale; tint?: boolean }) {
  const text = formatPercent(value, locale);
  if (text === null)
    return (
      <td className={`${s.cell} ${s.cellNa}`}>
        <span aria-hidden="true">–</span>
        <span className="sr-only">{t("an.notEnough")}</span>
      </td>
    );
  return (
    <td className={s.cell} style={tint ? { background: `color-mix(in srgb, var(--primary) ${Math.round((value ?? 0) * 0.35)}%, var(--card))` } : undefined}>
      {text}
    </td>
  );
}

function CohortTable({ cohorts, t, locale }: { cohorts: Overview["retention"]["cohorts"]; t: Translate; locale: Locale }) {
  if (cohorts.every((c) => c.joined === 0)) return <p className={s.empty}>{t("an.chart.empty")}</p>;
  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <caption className="sr-only">{t("an.chart.cohorts.title")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("an.chart.cohorts.month")}</th>
            <th scope="col">{t("an.chart.cohorts.joined")}</th>
            <th scope="col">{t("an.chart.cohorts.d30")}</th>
            <th scope="col">{t("an.chart.cohorts.d60")}</th>
            <th scope="col">{t("an.chart.cohorts.d90")}</th>
          </tr>
        </thead>
        <tbody>
          {cohorts.map((c) => (
            <tr key={c.month}>
              <th scope="row">{monthLabel(c.month, locale)}</th>
              <td className={s.cell}>{formatNumber(c.joined, locale)}</td>
              <PercentCell value={c.retained30} t={t} locale={locale} tint />
              <PercentCell value={c.retained60} t={t} locale={locale} tint />
              <PercentCell value={c.retained90} t={t} locale={locale} tint />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Bookings({ bookings, t, locale }: { bookings: Overview["bookings"]; t: Translate; locale: Locale }) {
  if (bookings.fillPercent === null) return <p className={s.empty}>{t("an.bookings.empty")}</p>;
  return (
    <>
      <div className={s.ringWrap}>
        <ProgressRing
          value={bookings.fillPercent}
          label={t("an.bookings.fill")}
          centerLabel={formatPercent(bookings.fillPercent, locale) ?? undefined}
          ariaLabel={t("an.bookings.aria")}
          valueLabel={t("an.bookings.fill")}
          maxLabel="100"
        />
      </div>
      <p className={s.hint}>
        {t("an.bookings.counts", { booked: bookings.booked, waitlisted: bookings.waitlisted, cancelled: bookings.cancelled })}
      </p>
    </>
  );
}

function FeePanel({ fees, t, locale }: { fees: Awaited<ReturnType<typeof getFeeStats>>; t: Translate; locale: Locale }) {
  if (fees.activeMembers === 0) return <p className={s.empty}>{t("an.chart.empty")}</p>;
  const paid = formatPercent(fees.paidPercent, locale);
  return (
    <>
      <Donut
        slices={feeSlices(fees.counts, t)}
        centerLabel={formatNumber(fees.activeMembers, locale) ?? "0"}
        centerSub={t("an.fees.center")}
        ariaLabel={t("an.fees.aria")}
        valueLabel={t("an.fee.members")}
      />
      <ul className={s.feeFacts}>
        {paid && <li>{t("an.fees.paidPercent", { percent: paid })}</li>}
        <li>{t("an.fees.dueSoon", { n: formatNumber(fees.dueNext7Days, locale) ?? "0" })}</li>
        <li>{t("an.fees.paidMonth", { n: formatNumber(fees.paidThisMonth, locale) ?? "0" })}</li>
      </ul>
      <p className={s.hint}>{t("an.fees.note")}</p>
    </>
  );
}

function CoachSnippet({ items, t, locale }: { items: Awaited<ReturnType<typeof getCoachWorkload>>["items"]; t: Translate; locale: Locale }) {
  if (items.length === 0) return <p className={s.empty}>{t("an.coaches.empty")}</p>;
  const top = [...items].sort((a, b) => b.sessions.scheduled - a.sessions.scheduled || a.coachName.localeCompare(b.coachName)).slice(0, 4);
  return (
    <ul className={s.list}>
      {top.map((c) => {
        const load = formatPercent(c.loadPercent, locale);
        return (
          <li key={c.coachId} className={s.row}>
            <div className={s.rowMain}>
              <strong>{c.coachName}</strong>
              <span className={s.rowMeta}>
                {t("an.coaches.row", { completed: formatNumber(c.sessions.completed, locale) ?? "0", scheduled: formatNumber(c.sessions.scheduled, locale) ?? "0" })}
              </span>
              <span className={s.rowMeta}>{t("an.coaches.load", { value: load ?? t("an.notEnough") })}</span>
            </div>
            {c.consistencyPercent !== null && <Badge tone="ok">{formatPercent(c.consistencyPercent, locale)}</Badge>}
          </li>
        );
      })}
    </ul>
  );
}

function Panel({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <Card title={title}>
      {hint && <p className={s.hint}>{hint}</p>}
      {children}
    </Card>
  );
}

function FollowUps({ items, t, locale }: { items: Insights["followUps"]; t: Translate; locale: Locale }) {
  return (
    <Panel title={t("an.followups.title")} hint={t("an.followups.hint")}>
      {items.length === 0 ? (
        <p className={s.empty}>{t("an.followups.empty")}</p>
      ) : (
        <ul className={s.list}>
          {items.map((f) => (
            <li key={f.memberId} className={s.row}>
              <div className={s.rowMain}>
                <Link href={`/owner/members/${f.memberId}`}>{f.memberName}</Link>
                <span className={s.rowMeta}>{followUpReason(f.reason, f.detail, t, locale)}</span>
                {f.coachName && <span className={s.rowMeta}>{t("an.followups.coach", { coach: f.coachName })}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Renewals({ items, t, locale }: { items: Insights["renewals"]; t: Translate; locale: Locale }) {
  return (
    <Panel title={t("an.renewals.title")} hint={t("an.renewals.hint")}>
      {items.length === 0 ? (
        <p className={s.empty}>{t("an.renewals.empty")}</p>
      ) : (
        <ul className={s.list}>
          {items.map((r) => (
            <li key={r.memberId} className={s.row}>
              <div className={s.rowMain}>
                <Link href={`/owner/members/${r.memberId}`}>{r.memberName}</Link>
                <span className={s.rowMeta}>
                  {t("an.renewals.attendance", { value: formatPercent(r.attendancePercent30d, locale) ?? t("an.notEnough") })}
                </span>
              </div>
              <Badge tone={r.feeStatus === "overdue" ? "warn" : "info"}>
                {r.feeStatus === "overdue" || !r.feeDueOn ? t("an.renewals.overdue") : t("an.renewals.due", { date: shortDate(r.feeDueOn, locale) })}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Unlogged({ items, t, locale }: { items: Insights["unloggedSessions"]; t: Translate; locale: Locale }) {
  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale === "en" ? "en-IN" : locale, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(new Date(iso));
  return (
    <Panel title={t("an.unlogged.title")} hint={t("an.unlogged.hint")}>
      {items.length === 0 ? (
        <p className={s.empty}>{t("an.unlogged.empty")}</p>
      ) : (
        <ul className={s.list}>
          {items.map((u) => (
            <li key={u.sessionId} className={s.row}>
              <div className={s.rowMain}>
                <strong>{u.batchName}</strong>
                <span className={s.rowMeta}>{`${u.coachName} · ${when(u.startsAt)}`}</span>
              </div>
              {u.isGroupClass && <Badge tone="info">{t("an.unlogged.group")}</Badge>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
