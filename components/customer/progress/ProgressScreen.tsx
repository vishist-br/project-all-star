import Link from "next/link";
import { addDays } from "@/lib/api/schedule";
import { listGoals } from "@/lib/api/goals";
import { getMember } from "@/lib/api/members";
import { getMemberStats } from "@/lib/api/member-stats";
import { loadTenantSettings } from "@/lib/api/tenant-settings";
import { listWorkoutLogs } from "@/lib/api/workout-logs";
import { BarChart, Donut, LineChart, ProgressRing } from "@/components/charts";
import { BeltCard } from "@/components/skills/BeltCard";
import { getMemberSkillProgress } from "@/lib/api/skills";
import { beltCards, type SkillProgress } from "@/lib/skills/view";
import { MuscleBars } from "@/components/muscle-volume/MuscleBars";
import { getMuscleVolume } from "@/lib/api/muscle-volume";
import { ChildSwitcher } from "@/components/customer/ChildSwitcher";
import { NoMember } from "@/components/customer/NoMember";
import { Badge, Card, EmptyState, PageHeader, ProgressBar, Segmented, StatGrid, StatTile } from "@/components/ui";
import { listAchievements } from "@/lib/customer/achievements";
import { formatDay } from "@/lib/customer/format";
import { goalValueText, hasData, orderGoals, percentText, weeklyAttendanceSeries, weeklyWorkoutSeries } from "@/lib/customer/progress";
import { allow, getCustomerContext } from "@/lib/customer/server";
import { getT } from "@/lib/i18n/server";
import s from "./Progress.module.css";

type Search = Record<string, string | string[] | undefined>;

const GOAL_UNIT = {
  sessions_attended: "cp.goal.u.sessions_attended",
  workouts_completed: "cp.goal.u.workouts_completed",
  level: "cp.goal.u.level",
  custom: "cp.goal.u.custom",
} as const;
const WORKOUT_STATUS = {
  completed: "cp.history.workoutDone",
  started: "cp.history.workoutStarted",
  stopped: "cp.history.workoutStopped",
  skipped: "cp.history.workoutSkipped",
} as const;

/** Customer Progress: level ring, goals (numbers straight from the API), attendance, streaks, charts, achievements and history. */
export async function ProgressScreen({ searchParams }: { searchParams: Search }) {
  const { t, locale } = await getT();
  const ctx = await getCustomerContext();
  if (!ctx.selected) return <NoMember />;
  const { principal, db, today, selected } = ctx;
  for (const op of ["getMemberStats", "listGoals", "getMember", "listWorkoutLogs"] as const) allow(principal, op);

  const days = searchParams.days === "90" ? 90 : 30;
  const [stats, goals, member, settings, achievements, logs] = await Promise.all([
    getMemberStats(db, principal, selected.id, new URLSearchParams({ from: addDays(today, 1 - days), to: today })),
    listGoals(db, principal, selected.id, new URLSearchParams()),
    getMember(db, principal, selected.id),
    loadTenantSettings(db),
    listAchievements(db, principal, selected.id),
    listWorkoutLogs(db, principal, selected.id, new URLSearchParams({ limit: "8" })),
  ]);

  let belts: ReturnType<typeof beltCards> = [];
  try {
    allow(principal, "getMemberSkillProgress");
    belts = beltCards((await getMemberSkillProgress(db, principal, selected.id, new URLSearchParams())) as unknown as SkillProgress);
  } catch (err) {
    console.error("belt card failed", err instanceof Error ? err.message : err);
  }

  let muscles: Awaited<ReturnType<typeof getMuscleVolume>> | null = null;
  try {
    allow(principal, "getMuscleVolume");
    muscles = await getMuscleVolume(db, principal, selected.id, new URLSearchParams({ range: "7d" }));
  } catch (err) {
    console.error("muscle volume failed", err instanceof Error ? err.message : err);
  }

  const noData = t("cp.noData");
  const att = stats.attendance;
  const wk = stats.workouts;
  const labels = stats.weekly.map((w) => formatDay(w.weekStart, locale));
  const attSeries = weeklyAttendanceSeries(stats.weekly);
  const wkSeries = weeklyWorkoutSeries(stats.weekly);
  const lvl = stats.level;
  const period = [
    { href: "?days=30", label: t("cp.range.30"), active: days === 30 },
    { href: "?days=90", label: t("cp.range.90"), active: days === 90 },
  ];
  const tile = (v: string | null) => v ?? <span className={s.small}>{noData}</span>;

  return (
    <div className={s.stack}>
      <PageHeader title={t("cp.title")} subtitle={selected.isOwn ? t("cp.subtitle.self") : t("cp.subtitle.child", { name: selected.name })} />
      <ChildSwitcher members={ctx.children} selectedId={selected.id} />
      <Segmented label={t("cp.range.label")} items={period} />
      <Link className="btn btn-secondary" href="/customer/progress/week" data-testid="weekly-card-link">{t("pc.open")}</Link>

      <Link className="btn btn-secondary" href="/customer/progress/exercises" data-testid="exercises-link">{t("xp.link.exercises")}</Link>

      <Link className="btn btn-secondary" href="/customer/progress/body" data-testid="body-link">{t("gx.bm.link")}</Link>
      <Link className="btn btn-secondary" href="/customer/progress/muscles" data-testid="muscles-link">{t("gx.mv.link")}</Link>

      {muscles?.hasGymData && muscles.muscles.length > 0 && (
        <Card title={t("gx.mv.cardWeek")} actions={<Link href="/customer/progress/muscles">{t("gx.mv.seeAll")}</Link>}>
          <MuscleBars rows={muscles.muscles.slice(0, 6)} t={t} weeks={muscles.weeks} />
        </Card>
      )}

      {belts.map((b) => (
        <BeltCard key={b.checklist.checklistId} model={b} href="/customer/progress/skills" />
      ))}

      <Card title={t("cp.level.title")}>
        {lvl ? (
          <div className={s.levelRow}>
            <div className={s.levelRing}>
              <ProgressRing
                value={lvl.progressPercent}
                label={lvl.name}
                centerLabel={percentText(lvl.progressPercent) ?? "–"}
                ariaLabel={t("cp.level.ring")}
                valueLabel={t("cp.level.value")}
                maxLabel={t("cp.level.max")}
              />
            </div>
            <div className={s.levelText}>
              <p className={s.big} data-testid="level-name">{lvl.name}</p>
              <p className={s.meta}>{lvl.nextName ? t("cp.level.next", { name: lvl.nextName }) : t("cp.level.top")}</p>
            </div>
          </div>
        ) : (
          <p className="muted">{t("cp.level.none")}</p>
        )}
      </Card>

      <section aria-label={t("cp.att.title")} className={s.stack}>
        <StatGrid>
          <StatTile label={t("cp.stat.attendance")} value={tile(percentText(att.percent))} />
          <StatTile label={t("cp.stat.adherence")} value={tile(percentText(wk.adherencePercent))} />
          <StatTile label={t("cp.stat.streak")} value={t("cp.stat.days", { n: stats.streaks.currentActiveDays })} />
          <StatTile label={t("cp.stat.longest")} value={t("cp.stat.days", { n: stats.streaks.longestActiveDays })} />
          <StatTile label={t("cp.stat.hours")} value={att.hoursAttended} />
        </StatGrid>
        <p className={s.meta} data-testid="attendance-counts">
          {t("cp.att.counts", { attended: att.attended, missed: att.missed, excused: att.excused })}. {t("cp.att.note")}
        </p>
      </section>

      <section aria-label={t("cp.goals.title")} className={s.stack}>
        <h2>{t("cp.goals.title")}</h2>
        {goals.items.length === 0 ? (
          <EmptyState title={t("cp.goals.empty.title")} text={t("cp.goals.empty.body")} icon="◎" />
        ) : (
          <ul className={s.goals}>
            {orderGoals(goals.items).map((g) => {
              const unit = t(GOAL_UNIT[g.metric as keyof typeof GOAL_UNIT] ?? GOAL_UNIT.custom);
              const value = goalValueText(g, unit);
              return (
                <li key={g.id} className={s.goal} data-testid="goal" data-metric={g.metric}>
                  <div className={s.goalHead}>
                    <p className={s.goalTitle}>{g.title}</p>
                    <Badge tone={g.status === "achieved" ? "ok" : g.status === "dropped" ? "neutral" : "info"}>
                      {t(`cp.goal.status.${g.status as "active" | "achieved" | "dropped"}`)}
                    </Badge>
                  </div>
                  <ProgressBar value={g.progressPercent} label={t("cp.goal.bar", { title: g.title })} />
                  <p className={s.meta}>
                    <span data-testid="goal-percent">{t("cp.goal.percent", { n: g.progressPercent })}</span>
                    {" · "}
                    <span data-testid="goal-value">{value ?? t("cp.goal.noValue")}</span>
                    {g.targetDate && ` · ${t("cp.goal.target", { date: formatDay(g.targetDate, locale) })}`}
                  </p>
                  {g.checkIns.length > 0 && (
                    <details>
                      <summary className={s.summary}>{t("cp.goal.checkins")} ({g.checkIns.length})</summary>
                      <ul className={s.checkins}>
                        {g.checkIns.slice(0, 8).map((c) => (
                          <li key={c.id}>
                            <span>{formatDay(c.recordedOn, locale)}</span>
                            <strong>{c.value} {g.unit ?? ""}</strong>
                            {c.note && <span className="muted">{c.note}</span>}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <Card title={t("cp.chart.attendance")}>
        {hasData(attSeries) ? (
          <LineChart labels={labels} series={[{ name: t("cp.stat.attendance"), values: attSeries }]} ariaLabel={t("cp.chart.attendanceAria")} percent />
        ) : (
          <p className="muted">{t("cp.chart.empty")}</p>
        )}
      </Card>

      <div className={s.twoCol}>
        <Card title={t("cp.chart.workouts")}>
          {hasData(wkSeries.scheduled) ? (
            <BarChart
              labels={labels}
              ariaLabel={t("cp.chart.workoutsAria")}
              series={[
                { name: t("cp.chart.completed"), values: wkSeries.completed },
                { name: t("cp.chart.planned"), values: wkSeries.scheduled },
              ]}
            />
          ) : (
            <p className="muted">{t("cp.chart.empty")}</p>
          )}
        </Card>
        <Card title={t("cp.workouts.title")}>
          {wk.scheduled > 0 ? (
            <>
              <Donut
                slices={[
                  { label: t("cp.workouts.done"), value: wk.completed },
                  { label: t("cp.workouts.pending"), value: wk.pending },
                  { label: t("cp.workouts.skipped"), value: wk.skipped },
                ]}
                centerLabel={String(wk.completed)}
                centerSub={t("cp.workouts.centerSub")}
                ariaLabel={t("cp.workouts.aria")}
                valueLabel={t("cp.workouts.count")}
              />
              {wk.upcoming > 0 && <p className={s.meta}>{t("cp.workouts.upcoming", { n: wk.upcoming })}</p>}
            </>
          ) : (
            <p className="muted">{noData}</p>
          )}
        </Card>
      </div>

      {settings.showMissedSessionCost && (
        <Card title={t("cp.cost.title")}>
          <p data-testid="missed-cost">{att.missed > 0 ? t("cp.cost.body", { n: att.missed }) : t("cp.cost.none")}</p>
        </Card>
      )}

      <Card title={t("cp.ach.title")}>
        {achievements.length === 0 ? (
          <p className="muted">{t("cp.ach.empty")}</p>
        ) : (
          <ul className={s.chips}>
            {achievements.map((a) => (
              <li key={a.id} className={s.ach} data-testid="achievement">
                <strong>{a.title}</strong> · {t("cp.ach.earned", { date: formatDay(a.earnedOn, locale) })}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className={s.twoCol}>
        <Card title={`${t("cp.history.title")}: ${t("cp.history.classes")}`}>
          {member.recentSessions.length === 0 ? (
            <p className="muted">{t("cp.history.empty")}</p>
          ) : (
            <ul className={s.list}>
              {member.recentSessions.map((r) => (
                <li key={r.sessionId}>
                  <span>{formatDay(r.date, locale)}</span>
                  <Badge tone={r.attendance === "present" ? "ok" : r.attendance === "excused" ? "info" : "neutral"}>
                    {r.attendance === "present"
                      ? t("cs.att.present")
                      : r.attendance === "excused"
                        ? t("cs.att.excused")
                        : r.attendance === "absent"
                          ? t("cs.att.absent")
                          : t("cs.att.notMarked")}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={`${t("cp.history.title")}: ${t("cp.history.workouts")}`}>
          {logs.items.length === 0 ? (
            <p className="muted">{t("cp.history.empty")}</p>
          ) : (
            <ul className={s.list}>
              {logs.items.map((l) => (
                <li key={l.id}>
                  <span>
                    {formatDay(l.scheduledFor, locale)} · {l.exerciseName}
                  </span>
                  <Badge tone={l.status === "completed" ? "ok" : "neutral"}>{t(WORKOUT_STATUS[l.status as keyof typeof WORKOUT_STATUS] ?? "cp.history.workoutStarted")}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
