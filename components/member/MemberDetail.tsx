import { notFound } from "next/navigation";
import { BarChart, LineChart, ProgressRing } from "@/components/charts";
import { AssignmentsPanel } from "@/components/member/AssignmentsPanel";
import { GoalsPanel } from "@/components/member/GoalsPanel";
import { SignInLinkCard } from "@/components/member/SignInLinkCard";
import s from "@/components/member/member.module.css";
import { Avatar, Badge, type Tone } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { Card, StatGrid, StatTile } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { Segmented } from "@/components/ui/Tabs";
import { ErrorState } from "@/components/ui/States";
import { CoachNoteCard } from "@/components/progress-card/CoachNoteCard";
import { getProgressNote } from "@/lib/api/progress-card";
import { mondayOf } from "@/lib/progress-card/rules";
import { ApiError } from "@/lib/auth/errors";
import type { MessageKey } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { loadMemberDetail } from "@/lib/members/server";
import { PERIODS, percentText, shortDate, weeklySeries } from "@/lib/members/view";
import { getViewer } from "@/lib/viewer";

const FEE_TONE: Record<string, Tone> = { paid: "ok", due: "warn", overdue: "danger" };
const ATT_TONE: Record<string, Tone> = { present: "ok", absent: "warn", excused: "info", not_marked: "neutral" };

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

/** One member for the coach (own members) and the owner (all). Reads and writes go through lib/api with the viewer's principal. */
export async function MemberDetail({ role, memberId, days }: { role: "coach" | "owner"; memberId: string; days: (typeof PERIODS)[number] }) {
  const { t, locale } = await getT();
  const { db, principal } = await getViewer();

  let data: Awaited<ReturnType<typeof loadMemberDetail>>;
  try {
    data = await loadMemberDetail(db, principal, memberId, days);
  } catch (err) {
    if (err instanceof ApiError && err.code === "not_found") notFound();
    if (err instanceof ApiError && err.code === "forbidden") {
      return (
        <>
          <PageHeader title={t("member.notYours.title")} />
          <div className="state" role="alert">
            <p>{t("member.notYours.text")}</p>
            <ButtonLink variant="secondary" href={`/${role}/members`}>{t("member.back")}</ButtonLink>
          </div>
        </>
      );
    }
    console.error("member detail failed", err);
    return (
      <>
        <PageHeader title={t("nav.members")} />
        <ErrorState title={t("ui.errorTitle")} message={t("member.loadError")} />
        <ButtonLink variant="secondary" href={`/${role}/members`}>{t("member.back")}</ButtonLink>
      </>
    );
  }

  const { member: m, stats, goals, assignments, updates, schedule, canManage, levels, plans, today } = data;
  const note = canManage ? await getProgressNote(db, principal, memberId, new URLSearchParams()) : { weekStart: mondayOf(today), note: null };
  const notEnough = t("roster.notEnough");
  const series = weeklySeries(stats.weekly, (d) => shortDate(d, locale));
  const marked = stats.attendance.attended + stats.attendance.missed;
  const base = `/${role}/members/${memberId}`;
  const week = schedule.days.filter((d) => d.isHoliday || d.items.length > 0 || d.sessions.length > 0);

  return (
    <div className={s.stack}>
      <PageHeader
        title={m.name}
        subtitle={[m.level, m.status === "ended" ? t("member.statusEnded") : null].filter(Boolean).join(" · ") || undefined}
        actions={
          <>
            <ButtonLink variant="secondary" href={`/${role}/members`}>{t("member.back")}</ButtonLink>
            {canManage && m.status !== "ended" && <ButtonLink href={`/coach/sessions/new?memberId=${memberId}`}>{t("member.scheduleSession")}</ButtonLink>}
          </>
        }
      />
      {!canManage && <p className={s.banner} role="status">{t("member.readOnly")}</p>}

      <Card title={t("member.profile")}>
        <div className={s.profile}>
          <div className={s.profileTop}>
            <Avatar name={m.name} />
            <p className={s.profileName}>{m.name}</p>
            {m.feeStatus && <Badge tone={FEE_TONE[m.feeStatus] ?? "neutral"}>{t(`fee.${m.feeStatus}` as MessageKey)}</Badge>}
          </div>
          <p className={s.meta}>{t("member.joined", { date: shortDate(m.joinDate, locale) })}{m.guardianName ? ` · ${t("member.guardian", { name: m.guardianName })}` : ""}{m.phone ? ` · ${t("member.phone", { phone: m.phone })}` : ""}</p>
          <p className={s.meta}>{m.feeStatus ? `${t("member.feeNote")} ` : ""}</p>
        </div>
      </Card>

      <Segmented
        label={t("member.period")}
        items={PERIODS.map((p) => ({ href: `${base}?days=${p}`, label: t(`member.period.${p}` as MessageKey), active: p === days }))}
      />

      <StatGrid>
        <StatTile label={t("member.stat.attendance")} value={percentText(stats.attendance.percent, notEnough)} previous={t("member.stat.attendanceCounts", { attended: stats.attendance.attended, excused: stats.attendance.excused, missed: stats.attendance.missed })} />
        <StatTile label={t("member.stat.adherence")} value={percentText(stats.workouts.adherencePercent, notEnough)} previous={t("member.stat.adherenceCounts", { completed: stats.workouts.completed, scheduled: stats.workouts.scheduled })} />
        <StatTile label={t("member.stat.streak")} value={t("member.stat.streakValue", { n: stats.streaks.currentActiveDays })} previous={t("member.stat.longest", { n: stats.streaks.longestActiveDays })} />
        <StatTile label={t("member.stat.hours")} value={stats.attendance.hoursAttended} />
      </StatGrid>
      <p className={s.note}>{t("member.countNote")}</p>

      <div className={s.cols}>
        <Card title={t("member.chart.attendance")}>
          {series.hasAttendance ? (
            <BarChart
              ariaLabel={t("member.chart.attendanceAria")}
              labels={series.labels}
              series={[
                { name: t("member.chart.attended"), values: series.attended },
                { name: t("member.chart.missed"), values: series.missed, color: "var(--c2)" },
              ]}
            />
          ) : (
            <p className="muted">{t("member.chart.empty")}</p>
          )}
          {marked === 0 && series.hasAttendance && <p className={s.note}>{notEnough}</p>}
        </Card>
        <Card title={t("member.chart.adherence")}>
          {series.hasWorkouts ? (
            <LineChart ariaLabel={t("member.chart.adherenceAria")} labels={series.labels} percent series={[{ name: t("member.chart.adherenceSeries"), values: series.adherence }]} />
          ) : (
            <p className="muted">{t("member.chart.empty")}</p>
          )}
        </Card>
      </div>

      <Card title={t("member.level")}>
        {stats.level ? (
          <div className={s.levelRow}>
            <div className={s.ring}>
              <ProgressRing
                value={stats.level.progressPercent}
                label={stats.level.name}
                ariaLabel={`${t("member.level.ring")}: ${stats.level.name}`}
                valueLabel={t("member.level.value")}
                maxLabel={t("member.level.max")}
                centerLabel={stats.level.progressPercent === null ? "–" : `${Math.round(stats.level.progressPercent)}%`}
              />
            </div>
            <div>
              <p className={s.profileName}>{stats.level.name}</p>
              <p className={s.meta}>{stats.level.nextName ? t("member.level.next", { name: stats.level.nextName }) : t("member.level.top")}</p>
            </div>
          </div>
        ) : (
          <p className="muted">{t("member.level.none")}</p>
        )}
      </Card>

      <div className={s.cols}>
        <GoalsPanel
          memberId={memberId}
          today={today}
          canManage={canManage}
          levels={levels}
          goals={goals.map((g) => ({
            id: g.id,
            title: g.title,
            metric: g.metric,
            status: g.status,
            targetValue: g.targetValue,
            currentValue: g.currentValue,
            unit: g.unit,
            targetLevelName: g.targetLevelName,
            targetDate: g.targetDate,
            progressPercent: g.progressPercent,
            checkIns: g.checkIns,
          }))}
        />
        <AssignmentsPanel
          role={role}
          member={{ id: memberId, name: m.name }}
          canManage={canManage && m.status !== "ended"}
          plans={plans}
          assignments={assignments.map((a) => ({ id: a.id, planTitle: a.planTitle, status: a.status, startsOn: a.startsOn, endsOn: a.endsOn, adherencePercent: a.adherencePercent, note: a.note }))}
        />
      </div>

      <div className={s.cols}>
        <Card title={t("member.history")}>
          {m.recentSessions.length === 0 ? (
            <p className="muted">{t("member.history.empty")}</p>
          ) : (
            <ul className={s.list}>
              {m.recentSessions.map((r) => (
                <li key={r.sessionId} className={s.itemHead}>
                  <span>{shortDate(r.date, locale)}</span>
                  <span className={s.chips}>
                    <Badge tone={ATT_TONE[r.attendance] ?? "neutral"}>{t(`member.att.${r.attendance}` as MessageKey)}</Badge>
                    {r.excusedReason && <span className={s.meta}>{t(`member.reason.${r.excusedReason}` as MessageKey)}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={t("member.schedule")}>
          {week.length === 0 ? (
            <p className="muted">{t("member.schedule.empty")}</p>
          ) : (
            <div className={s.list}>
              {week.map((d) => (
                <div key={d.date} className={s.day}>
                  <p className={s.dayName}>{shortDate(d.date, locale)}</p>
                  {d.isHoliday && <p className={s.meta}>{t("member.schedule.holiday", { name: d.holidayName ?? "" })}</p>}
                  {d.sessions.map((x) => <p key={x.id} className={s.meta}>{t("member.schedule.session", { batch: x.batchName, time: time(x.startsAt) })}</p>)}
                  {d.items.length > 0 && <p className={s.meta}>{t("member.schedule.workouts", { n: d.items.length, plans: [...new Set(d.items.map((i) => i.planTitle))].join(", ") })}</p>}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card title={t("member.updates")}>
        {updates.items.length === 0 ? (
          <p className="muted">{t("member.updates.empty")}</p>
        ) : (
          <ul className={s.list}>
            {updates.items.map((u) => (
              <li key={u.id} className={s.itemHead}>
                <span>{u.title}</span>
                <span className={s.chips}>
                  <span className={s.meta}>{shortDate(u.createdAt, locale)}</span>
                  <Badge tone={u.read ? "neutral" : "info"}>{u.read ? t("member.updates.read") : t("member.updates.unread")}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {canManage && <CoachNoteCard memberId={memberId} week={note.weekStart} initial={note.note ?? ""} />}

      {m.status === "active" && canManage && <SignInLinkCard memberId={memberId} />}
    </div>
  );
}
