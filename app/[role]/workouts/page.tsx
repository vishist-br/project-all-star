import Link from "next/link";
import { notFound } from "next/navigation";
import { listPlanAssignments } from "@/lib/api/assignments";
import { addDays, getMemberSchedule } from "@/lib/api/schedule";
import { getWorkoutPlan } from "@/lib/api/workout-plans";
import { ChildSwitcher } from "@/components/customer/ChildSwitcher";
import { NoMember } from "@/components/customer/NoMember";
import { TodayWorkouts } from "@/components/customer/workout/TodayWorkouts";
import { NewFromCoach } from "@/components/send/NewFromCoach";
import { Badge, ButtonLink, Card, EmptyState, PageHeader, SectionHeader } from "@/components/ui";
import { WorkoutsScreen, type WorkoutFilters } from "@/components/WorkoutsScreen";
import { formatDay } from "@/lib/customer/format";
import { targetParts, toWorkoutItems } from "@/lib/customer/items";
import { allow, getCustomerContext } from "@/lib/customer/server";
import { getT } from "@/lib/i18n/server";
import { isRole } from "@/lib/nav";
import s from "@/components/customer/Customer.module.css";

export const dynamic = "force-dynamic";

const COMING_DAYS = 7;

/**
 * Customers: their assigned plans and the daily schedule for the coming days (with one-tap logging
 * for today). Owner and coach keep the shared exercise library at this address.
 */
export default async function WorkoutsPage({
  params,
  searchParams,
}: {
  params: Promise<{ role: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { role } = await params;
  if (!isRole(role)) notFound();
  const { t, locale } = await getT();

  if (role !== "customer") {
    const sp = await searchParams;
    const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
    return (
      <section>
        <PageHeader title={t("nav.workouts")} />
        <WorkoutsScreen
          filters={{ q: one("q"), muscle: one("muscle"), equipment: one("equipment"), level: one("level"), sport: one("sport"), page: one("page") } satisfies WorkoutFilters}
        />
      </section>
    );
  }

  const ctx = await getCustomerContext();
  if (!ctx.selected) return <NoMember />;
  const { principal, db, today, selected } = ctx;
  allow(principal, "getMemberSchedule");
  allow(principal, "listPlanAssignments");
  allow(principal, "getWorkoutPlan");

  const [schedule, assignments] = await Promise.all([
    getMemberSchedule(db, principal, selected.id, new URLSearchParams({ from: today, to: addDays(today, COMING_DAYS - 1) })),
    listPlanAssignments(db, principal, new URLSearchParams({ memberId: selected.id, limit: "50" })),
  ]);
  const plans = assignments.items.filter((a) => a.status !== "ended");
  const descriptions = new Map<string, string | null>();
  await Promise.all(
    plans.map(async (a) => {
      try {
        descriptions.set(a.planId, (await getWorkoutPlan(db, principal, a.planId)).description);
      } catch {
        descriptions.set(a.planId, null);
      }
    }),
  );

  const todayDay = schedule.days[0]!;
  const todayItems = toWorkoutItems(todayDay);
  const coming = schedule.days.slice(1);

  return (
    <div className={s.stack}>
      <PageHeader title={t("cu.wk.title")} subtitle={t("cu.wk.subtitle")} />
      <ChildSwitcher members={ctx.children} selectedId={selected.id} />
      <NewFromCoach ctx={ctx} markRead />

      {plans.length === 0 ? (
        <EmptyState title={t("cu.wk.empty.title")} text={t("cu.wk.empty.body")} icon="✚" />
      ) : (
        <>
          <section aria-labelledby="plans-h" className={s.stack}>
            <SectionHeader title={<span id="plans-h">{t("cu.wk.plans")}</span>} />
            <ul className={s.planGrid}>
              {plans.map((a) => (
                <Card as="li" key={a.id} className="plan-card">
                  <div className={s.row}>
                    <h3 className={s.big}>{a.planTitle}</h3>
                    <span>
                      <Badge tone="info">{t(`cu.wk.cadence.${a.cadence}` as "cu.wk.cadence.daily")}</Badge>{" "}
                      {a.status === "paused" && <Badge tone="warn">{t("cu.wk.planPaused")}</Badge>}
                    </span>
                  </div>
                  {descriptions.get(a.planId) && <p className="muted">{descriptions.get(a.planId)}</p>}
                  <p className={s.meta}>
                    {t("cu.wk.planSince", { date: formatDay(a.startsOn, locale) })} · {t("cu.wk.planBy", { coach: a.assignedByName })}
                    {a.adherencePercent !== null && <> · {t("cu.wk.planProgress", { n: Math.round(a.adherencePercent) })}</>}
                  </p>
                  {a.note && <p className="small">{a.note}</p>}
                </Card>
              ))}
            </ul>
          </section>

          <section aria-labelledby="wk-today-h" className={s.stack}>
            <SectionHeader title={<span id="wk-today-h">{t("cu.wk.today")} · {formatDay(today, locale)}</span>} />
            {todayItems.length > 0 ? (
              <>
                <div className={s.liveCta}>
                  <div>
                    <strong>{t("lw.title")}</strong>
                    <p className={s.meta}>{t("lw.startHint")}</p>
                  </div>
                  <ButtonLink href="/customer/workouts/live" size="lg">{t("lw.start")}</ButtonLink>
                </div>
                <TodayWorkouts memberId={selected.id} date={today} items={todayItems} />
              </>
            ) : (
              <p className="muted">{t("cu.wk.rest")}</p>
            )}
          </section>

          <section aria-labelledby="coming-h" className={s.stack}>
            <SectionHeader title={<span id="coming-h">{t("cu.wk.coming")}</span>} />
            <p className={s.meta}>{t("cu.wk.laterNote")}</p>
            <ol className={s.days}>
              {coming.map((d) => (
                <Card as="li" key={d.date} className={s.day}>
                  <div className={s.dayHead}>
                    <h3 className={s.dayTitle}>{formatDay(d.date, locale)}{d.dayTitle ? ` · ${d.dayTitle}` : ""}</h3>
                    {d.isHoliday && <Badge tone="info">{t("cu.wk.holiday", { name: d.holidayName ?? "" })}</Badge>}
                    {d.items.length > 0 && <span className={s.meta}>{t("cu.wk.exercises", { n: d.items.length })}</span>}
                  </div>
                  {d.items.length === 0 ? (
                    <p className={s.meta}>{t("cu.wk.rest")}</p>
                  ) : (
                    <ul className={s.dayItems}>
                      {d.items.map((i) => (
                        <li key={`${i.assignmentId}-${i.planItemId}`}>
                          <Link href={`/customer/exercise/${i.exerciseId}?item=${i.planItemId}`}>{i.exerciseName}</Link>
                          <span className={s.meta}>{targetParts(i, t, locale).join(" · ")}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              ))}
            </ol>
          </section>
        </>
      )}
    </div>
  );
}
