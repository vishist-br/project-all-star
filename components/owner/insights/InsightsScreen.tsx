import Link from "next/link";
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { shortDay } from "@/lib/exercise/metrics";
import type { MessageKey } from "@/lib/i18n";
import { barPercent, clock, pct, suggestionText, typicalAttendance, weekdays, type Insights, type InsightRange, INSIGHT_RANGES } from "@/lib/insights/view";
import s from "./insights.module.css";

type T = (k: MessageKey, p?: Record<string, string | number>) => string;

/** Owner class insights: positive, plain, about the timetable. No coach is named. */
export function InsightsScreen({ data, range, t, locale }: { data: Insights; range: InsightRange; t: T; locale: string }) {
  const none = t("oi.noData");
  const overall = data.overall;
  const suggestions = data.suggestions.map((x) => ({ x, text: suggestionText(x, t) })).filter((x): x is { x: (typeof data.suggestions)[number]; text: string } => x.text !== null);

  return (
    <div className={s.stack}>
      <PageHeader title={t("oi.title")} subtitle={t("oi.subtitle")} />
      <nav className="segmented" aria-label={t("oi.range.label")} style={{ width: "fit-content", maxWidth: "100%" }}>
        {INSIGHT_RANGES.map((r) => (
          <Link key={r} href={r === "28d" ? "/owner/insights" : `/owner/insights?range=${r}`} className="seg" aria-current={r === range ? "true" : undefined} data-testid={`range-${r}`}>
            {t(`oi.range.${r}` as MessageKey)}
          </Link>
        ))}
      </nav>

      {data.slots.length === 0 ? (
        <EmptyState
          title={t("oi.empty.title")}
          text={t("oi.empty.body")}
          icon="◈"
          action={<ButtonLink href="/owner/batches" variant="secondary">{t("nav.batches")}</ButtonLink>}
        />
      ) : (
        <>
          <div className={s.tiles} role="group" aria-label={t("oi.tiles.label")}>
            <div className={s.tile} data-testid="tile-fill">
              <span className={s.tileLabel}>{t("oi.tile.fill")}</span>
              <span className={s.tileValue}>{pct(overall.avgFillRate, locale) ?? none}</span>
              <span className={s.tileNote}>{t("oi.tile.held", { n: overall.classesHeld })}</span>
            </div>
            <div className={s.tile} data-testid="tile-attendance">
              <span className={s.tileLabel}>{t("oi.tile.attendance")}</span>
              <span className={s.tileValue}>{pct(overall.attendanceRate, locale) ?? none}</span>
              <span className={s.tileNote}>{t("oi.tile.attendanceNote")}</span>
            </div>
            <div className={s.tile} data-testid="tile-workout">
              <span className={s.tileLabel}>{t("oi.tile.workout")}</span>
              <span className={s.tileValue}>{pct(overall.workoutSentShare, locale) ?? none}</span>
              <span className={s.tileNote}>{t("oi.tile.workoutNote")}</span>
            </div>
          </div>

          <p className={s.period}>{t("oi.period", { from: shortDay(data.from, locale), to: shortDay(data.to, locale) })}</p>

          <ul className={s.slots} aria-label={t("oi.slots.label")}>
            {data.slots.map((slot) => {
              const typical = typicalAttendance(slot);
              const fill = pct(slot.avgFillRate, locale);
              return (
                <Card as="li" key={slot.batchId} className="insight-slot">
                  <div className={s.slot} data-testid="class-slot">
                    <div className={s.slotHead}>
                      <div>
                        <h2 className={s.slotName}>{slot.batchName}</h2>
                        <p className={s.when}>
                          {weekdays(slot.daysOfWeek, locale)} · {clock(slot.startTime, locale)} to {clock(slot.endTime, locale)}
                        </p>
                      </div>
                      <div className={s.badges}>
                        {slot.waitlistCount > 0 && <Badge tone="info">{t("oi.slot.waitlist", { n: slot.waitlistCount })}</Badge>}
                        {slot.quietSlot && <Badge tone="neutral">{t("oi.slot.quiet")}</Badge>}
                      </div>
                    </div>
                    {slot.sessionCount === 0 ? (
                      <p className="muted">{t("oi.slot.noClasses")}</p>
                    ) : (
                      <>
                        <div
                          role="progressbar"
                          aria-label={t("oi.slot.fillAria", { name: slot.batchName })}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={slot.avgFillRate === null ? undefined : Math.round(slot.avgFillRate)}
                          className={s.bar}
                        >
                          <span className={s.barFill} style={{ width: `${barPercent(slot.avgFillRate)}%` }} />
                        </div>
                        <div className={s.fillRow}>
                          <span>{typical ? t("oi.slot.booked", { n: typical.n, of: typical.of }) : t("oi.slot.noCap")}</span>
                          <strong>{fill ? t("oi.slot.fill", { pct: fill }) : none}</strong>
                        </div>
                        <dl className={s.facts}>
                          <div>
                            <dt>{t("oi.slot.held")}</dt>
                            <dd>{slot.sessionCount}</dd>
                          </div>
                          <div>
                            <dt>{t("oi.tile.attendance")}</dt>
                            <dd>{pct(slot.attendanceRate, locale) ?? none}</dd>
                          </div>
                          <div>
                            <dt>{t("oi.slot.workout")}</dt>
                            <dd>{pct(slot.workoutSentShare, locale) ?? none}</dd>
                          </div>
                        </dl>
                        {slot.quietSlot && <p className="small muted">{t("oi.slot.quietHint")}</p>}
                      </>
                    )}
                  </div>
                </Card>
              );
            })}
          </ul>

          <section className={s.suggCard} aria-labelledby="sugg-h" data-testid="suggestions">
            <h2 id="sugg-h" className={s.suggTitle}>{t("oi.sugg.title")}</h2>
            {suggestions.length === 0 ? (
              <p>{t("oi.sugg.empty")}</p>
            ) : (
              <ul className={s.suggList}>
                {suggestions.map(({ x, text }, i) => (
                  <li key={`${x.kind}-${x.batchId}-${i}`}>{text}</li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
