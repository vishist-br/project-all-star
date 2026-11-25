import Link from "next/link";
import { notFound } from "next/navigation";
import { assignmentWhere } from "@/lib/auth/access";
import { addDays, getMemberSchedule, loadScheduledEntries } from "@/lib/api/schedule";
import { getMemberStats } from "@/lib/api/member-stats";
import { ChildSwitcher } from "@/components/customer/ChildSwitcher";
import { NoMember } from "@/components/customer/NoMember";
import { TodayWorkouts } from "@/components/customer/workout/TodayWorkouts";
import { LatestClasses } from "@/components/classes/LatestClasses";
import { NewFromCoach } from "@/components/send/NewFromCoach";
import { Badge, ButtonLink, Card, EmptyState, PageHeader, SectionHeader, StatGrid, StatTile } from "@/components/ui";
import { formatDay, formatWhen } from "@/lib/customer/format";
import { toWorkoutItems } from "@/lib/customer/items";
import { allow, getCustomerContext } from "@/lib/customer/server";
import { getT } from "@/lib/i18n/server";
import s from "@/components/customer/Customer.module.css";

export const dynamic = "force-dynamic";

/** Customer home: today's workouts, next sessions, what's new and quick stats for the chosen member. */
export default async function CustomerHome({ params }: { params: Promise<{ role: string }> }) {
  if ((await params).role !== "customer") notFound();
  const { t } = await getT();
  const ctx = await getCustomerContext();
  if (!ctx.selected) return <NoMember />;
  const { selected } = ctx;

  // The page itself does no more awaiting: the inbox, the class summary and the body are sibling async
  // components, so their queries run at the same time instead of one after the other (STAR-102).
  return (
    <div className={s.stack}>
      <PageHeader
        title={t("cu.home.greeting", { name: ctx.userName })}
        subtitle={selected.isOwn ? t("cu.home.subtitleSelf") : t("cu.home.subtitleChild", { name: selected.name })}
      />
      <ChildSwitcher members={ctx.children} selectedId={selected.id} />
      <NewFromCoach ctx={ctx} />
      <LatestClasses ctx={ctx} heading={t("csm.home.title")} />

      <HomeBody ctx={ctx} />
    </div>
  );
}

/** Today's workouts, updates, next sessions and stats of the selected member. */
async function HomeBody({ ctx }: { ctx: Awaited<ReturnType<typeof getCustomerContext>> }) {
  const { t, locale } = await getT();
  const { principal, db, today, now } = ctx;
  const selected = ctx.selected!;

  allow(principal, "getMemberSchedule");
  allow(principal, "getMemberStats");
  allow(principal, "listPlanAssignments");
  // One schedule load serves both the week ahead and the 30-day stats (STAR-102).
  const entries = loadScheduledEntries(db, [selected.id], addDays(today, -29), addDays(today, 6));
  const [schedule, stats, activePlans] = await Promise.all([
    getMemberSchedule(db, principal, selected.id, new URLSearchParams({ from: today, to: addDays(today, 6) }), now, entries),
    getMemberStats(db, principal, selected.id, new URLSearchParams(), now, entries),
    // Only "does this member have an active plan" is needed here, so a count, not the full list.
    db.planAssignment.count({ where: { AND: [assignmentWhere(principal), { memberId: selected.id, status: "ACTIVE" }] } }),
  ]);

  const todayDay = schedule.days[0]!;
  const items = toWorkoutItems(todayDay);
  const nextWorkoutDay = schedule.days.find((d) => d.date > today && d.items.length > 0);
  const sessions = schedule.days
    .flatMap((d) => d.sessions)
    .filter((x) => x.status === "scheduled" && new Date(x.startsAt).getTime() >= now.getTime());
  const next = sessions[0];
  const later = sessions.slice(1, 4);
  const unread = schedule.unreadUpdates;
  const none = t("cu.stats.noValue");

  return (
    <>
      <section aria-labelledby="today-h" className={s.stack}>
        <SectionHeader title={<span id="today-h">{t("cu.today.title")}</span>} />
        {items.length > 0 ? (
          <TodayWorkouts memberId={selected.id} date={today} items={items} />
        ) : activePlans === 0 ? (
          <EmptyState title={t("cu.today.empty.title")} text={t("cu.today.empty.body")} icon="✚" />
        ) : (
          <EmptyState
            title={t("cu.today.none.title")}
            text={
              nextWorkoutDay
                ? t("cu.today.none.body", { date: formatDay(nextWorkoutDay.date, locale) })
                : t("cu.today.none.bodyNoNext")
            }
            action={<ButtonLink href="/customer/workouts" variant="secondary">{t("nav.workouts")}</ButtonLink>}
            icon="☀"
          />
        )}
      </section>

      <Card title={t("cu.updates.title")}>
        <div className={s.updatesBar}>
          {unread > 0 ? (
            <Badge tone="info">{t("cu.updates.badge", { n: unread })}</Badge>
          ) : (
            <span className="muted">{t("cu.updates.none")}</span>
          )}
          <ButtonLink href="/customer/updates" variant={unread > 0 ? "primary" : "secondary"}>
            {t("cu.updates.open")}
          </ButtonLink>
        </div>
      </Card>

      <Card title={t("cu.next.title")}>
        {next ? (
          <div className={s.stack}>
            <div>
              <p className={s.big}>{next.batchName}</p>
              <p className={s.meta}>
                {formatWhen(next.startsAt, locale)} · {t("cu.next.with", { coach: next.coachName })}
              </p>
            </div>
            {next.myBookingStatus === "booked" && <p><Badge tone="ok">{t("cu.next.booked")}</Badge></p>}
            {next.myBookingStatus === "waitlisted" && <p><Badge tone="warn">{t("cu.next.waitlisted")}</Badge></p>}
            {later.length > 0 && (
              <div>
                <h3 className={s.meta}>{t("cu.upcoming.title")}</h3>
                <ul className={s.sessionList}>
                  {later.map((x) => (
                    <li key={x.id}>
                      <strong>{x.batchName}</strong>
                      <span className={s.meta}>{formatWhen(x.startsAt, locale)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p>
              <Link href="/customer/schedule">{t("cu.next.seeSchedule")}</Link>
            </p>
          </div>
        ) : (
          <p className="muted">{t("cu.next.none")}</p>
        )}
      </Card>

      <section aria-labelledby="stats-h">
        <SectionHeader title={<span id="stats-h">{t("cu.stats.title")}</span>} />
        <StatGrid>
          <StatTile label={t("cu.stats.attendance")} value={stats.attendance.percent === null ? none : `${stats.attendance.percent}%`} />
          <StatTile label={t("cu.stats.streak")} value={stats.streaks.currentActiveDays} />
          <StatTile label={t("cu.stats.workouts")} value={`${stats.workouts.completed}/${stats.workouts.scheduled}`} />
          <StatTile label={t("cu.stats.level")} value={stats.level?.name ?? none} />
        </StatGrid>
      </section>
    </>
  );
}
