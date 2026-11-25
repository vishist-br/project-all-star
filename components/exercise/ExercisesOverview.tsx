import Link from "next/link";
import { getExerciseHistories } from "@/lib/api/workout-sets";
import { checkRole } from "@/lib/auth/guard";
import { Sparkline } from "@/components/charts";
import { ChildSwitcher } from "@/components/customer/ChildSwitcher";
import { NoMember } from "@/components/customer/NoMember";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { getCustomerContext } from "@/lib/customer/server";
import { formatValue, overviewOf, shortDay, type HistoryLike } from "@/lib/exercise/metrics";
import { loggedExercises } from "@/lib/exercise/server";
import { getT } from "@/lib/i18n/server";
import s from "./exercise.module.css";

/** Every exercise the member has logged, with the latest number and a small trend. Each row opens the exercise page. */
export async function ExercisesOverview() {
  const { t, locale } = await getT();
  const ctx = await getCustomerContext();
  if (!ctx.selected) return <NoMember />;
  const { principal, db, selected } = ctx;
  checkRole(principal, "getExerciseHistory");

  const exercises = await loggedExercises(db, selected.id);
  // One batched read for every exercise (a fixed number of queries, however many are logged).
  const histories = await getExerciseHistories(db, principal, selected.id, exercises.map((e) => e.id), new URLSearchParams({ range: "all" }));
  const historyOf = new Map(histories.map((h) => [h.exerciseId, h as unknown as HistoryLike]));
  const rows = exercises.flatMap((e) => {
    const h = historyOf.get(e.id);
    return h ? [{ e, o: overviewOf(h) }] : [];
  });
  const fmt = { t, locale };

  return (
    <div className={s.stack}>
      <Link href="/customer/progress" className={s.back}>
        <span aria-hidden="true">←</span>
        {t("xp.list.back")}
      </Link>
      <PageHeader title={t("xp.list.title")} subtitle={t("xp.list.subtitle")} />
      <ChildSwitcher members={ctx.children} selectedId={selected.id} />
      {rows.length === 0 ? (
        <EmptyState
          title={t("xp.list.empty.title")}
          text={t("xp.list.empty.body")}
          icon="↗"
          action={<Link className="btn btn-secondary" href="/customer/workouts">{t("xp.list.empty.action")}</Link>}
        />
      ) : (
        <ul className={s.exList} aria-label={t("xp.list.title")}>
          {rows.map(({ e, o }) => (
            <Card as="li" key={e.id}>
              <Link href={`/customer/exercise/${e.id}?from=progress`} className={s.exRow} data-testid="exercise-row">
                <span>
                  <span className={s.exName}>{e.name}</span>
                  <br />
                  <span className={s.exMeta}>
                    {t(o.metric.label)}: <strong>{formatValue(o.latest?.value ?? null, o.metric.unit, fmt)}</strong>
                  </span>
                  <br />
                  <span className={s.exMeta}>{t("xp.list.last", { date: shortDay(e.lastDate, locale), n: o.sessions })}</span>
                </span>
                <span className={s.exSpark}>
                  {o.spark.length > 1 ? <Sparkline values={o.spark} ariaLabel={t("xp.list.spark", { metric: t(o.metric.label), name: e.name })} color="var(--primary-text)" /> : null}
                </span>
              </Link>
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}
