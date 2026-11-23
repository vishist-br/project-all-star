import s from "@/components/member/member.module.css";
import { BarChart } from "@/components/charts";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { Card, StatGrid, StatTile } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { ErrorState } from "@/components/ui/States";
import { Segmented } from "@/components/ui/Tabs";
import type { MessageKey } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { loadCoachRecord } from "@/lib/members/server";
import { PERIODS, percentText, shortDate } from "@/lib/members/view";
import { CredentialManager } from "@/components/coach/credentials/CredentialManager";
import { listCoachCredentials } from "@/lib/api/coach-credentials";
import { getViewer } from "@/lib/viewer";

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

/**
 * Proof of delivered sessions from getCoachStats (and the coach's completed sessions). Takes the
 * coach id so the owner's coach detail can reuse it later; a coach can only load their own.
 */
export async function CoachRecord({ coachId, basePath, days }: { coachId: string; basePath: string; days: (typeof PERIODS)[number] }) {
  const { t, locale } = await getT();
  const { db, principal } = await getViewer();
  let data: Awaited<ReturnType<typeof loadCoachRecord>> | null = null;
  try {
    data = await loadCoachRecord(db, principal, coachId, days);
  } catch (err) {
    console.error("coach record failed", err);
  }
  let creds: Awaited<ReturnType<typeof listCoachCredentials>> | null = null;
  try {
    creds = await listCoachCredentials(db, principal, coachId);
  } catch (err) {
    console.error("coach credentials failed", err instanceof Error ? err.message : err);
  }
  const notEnough = t("roster.notEnough");

  return (
    <div className={s.stack}>
      <PageHeader title={t("nav.myRecord")} subtitle={t("record.subtitle")} />
      <Segmented
        label={t("record.period.label")}
        items={PERIODS.map((p) => ({ href: `${basePath}?days=${p}`, label: t(`record.period.${p}` as MessageKey), active: p === days }))}
      />
      {!data && <ErrorState title={t("ui.errorTitle")} message={t("record.loadError")} />}
      {data && (
        <>
          <p className={s.note}>{t("record.range", { from: shortDate(data.from, locale), to: shortDate(data.to, locale) })}</p>
          {data.stats.sessions.unlogged > 0 && <p className={s.banner} role="status">{t("record.unloggedHint", { n: data.stats.sessions.unlogged })}</p>}
          <StatGrid>
            <StatTile label={t("record.scheduled")} value={data.stats.sessions.scheduled} />
            <StatTile label={t("record.completed")} value={data.stats.sessions.completed} />
            <StatTile label={t("record.unlogged")} value={data.stats.sessions.unlogged} />
            <StatTile label={t("record.consistency")} value={percentText(data.stats.consistencyPercent, notEnough)} />
            <StatTile label={t("record.attendance")} value={percentText(data.stats.attendancePercent, notEnough)} />
            <StatTile label={t("record.adherence")} value={percentText(data.stats.workoutAdherencePercent, notEnough)} previous={t("record.activePlans", { n: data.stats.activePlans })} />
            <StatTile label={t("record.goalsAchieved")} value={data.stats.memberOutcomes.goalsAchieved} previous={t("record.goalsActive", { n: data.stats.memberOutcomes.goalsActive })} />
            <StatTile label={t("record.promotions")} value={data.stats.memberOutcomes.levelPromotions} />
            <StatTile label={t("record.members")} value={data.stats.memberCount} />
          </StatGrid>
          <p className={s.note}>{t("record.note")}</p>

          {creds && (
            <Card title={t("cred.title")}>
              <CredentialManager coachId={coachId} initial={creds.items} canVerify={false} canAdd={principal.role === "coach" && principal.userId === coachId} thisYear={new Date().getUTCFullYear()} />
            </Card>
          )}

          <Card title={t("record.chart.title")}>
            <BarChart
              ariaLabel={t("record.chart.aria")}
              labels={data.stats.weekly.map((w) => shortDate(w.weekStart, locale))}
              series={[
                { name: t("record.chart.scheduled"), values: data.stats.weekly.map((w) => w.scheduled), color: "var(--c2)" },
                { name: t("record.chart.completed"), values: data.stats.weekly.map((w) => w.completed) },
              ]}
            />
          </Card>

          <Card title={t("record.recent")}>
            {data.recent.length === 0 ? (
              <p className="muted">{t("record.recent.empty")}</p>
            ) : (
              <ul className={s.list}>
                {data.recent.map((x) => (
                  <li key={x.id} className={s.item}>
                    <div className={s.itemHead}>
                      <h3 className={s.itemTitle}>{x.batchName}</h3>
                      <span className={s.meta}>{shortDate(x.startsAt, locale)}, {time(x.startsAt)}</span>
                    </div>
                    <p className={s.meta}>
                      {x.attendanceSummary
                        ? t("record.session.counts", { present: x.attendanceSummary.present, absent: x.attendanceSummary.absent, excused: x.attendanceSummary.excused })
                        : t("record.session.noAttendance")}
                    </p>
                    <div className={s.rowActions}>
                      <Badge tone="ok">{t("status.completed")}</Badge>
                      <ButtonLink variant="ghost" href={`/coach/sessions/${x.id}`}>{t("record.open")}</ButtonLink>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
