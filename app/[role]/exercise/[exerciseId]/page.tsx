import { notFound } from "next/navigation";
import { getExercise } from "@/lib/api/exercises";
import { addDays, getMemberSchedule } from "@/lib/api/schedule";
import { ApiError } from "@/lib/auth/errors";
import { NoMember } from "@/components/customer/NoMember";
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { formatSeconds } from "@/lib/customer/format";
import { allow, getCustomerContext } from "@/lib/customer/server";
import { getT } from "@/lib/i18n/server";
import s from "@/components/customer/Customer.module.css";

export const dynamic = "force-dynamic";

/**
 * Exercise detail for a customer: instructions, muscles and equipment from the catalog (no images),
 * plus sets, reps, duration and rest from the member's own plan item when the exercise is in it.
 */
export default async function ExerciseDetail({
  params,
  searchParams,
}: {
  params: Promise<{ role: string; exerciseId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { role, exerciseId } = await params;
  if (role !== "customer") notFound();
  const sp = await searchParams;
  const itemId = typeof sp.item === "string" ? sp.item : undefined;
  const { t, locale } = await getT();
  const ctx = await getCustomerContext();
  if (!ctx.selected) return <NoMember />;
  const { principal, db, today, selected } = ctx;

  allow(principal, "getExercise");
  allow(principal, "getMemberSchedule");
  const back = (
    <ButtonLink href="/customer/workouts" variant="secondary">{t("ex.back")}</ButtonLink>
  );

  let exercise: Awaited<ReturnType<typeof getExercise>>;
  try {
    exercise = await getExercise(db, exerciseId);
  } catch (err) {
    if (err instanceof ApiError && err.code === "not_found") {
      return <EmptyState title={t("ex.notFound.title")} text={t("ex.notFound.body")} action={back} icon="?" />;
    }
    throw err;
  }

  const schedule = await getMemberSchedule(db, principal, selected.id, new URLSearchParams({ from: today, to: addDays(today, 13) }));
  const entries = schedule.days.flatMap((d) => d.items);
  const planItem = entries.find((i) => itemId && i.planItemId === itemId) ?? entries.find((i) => i.exerciseId === exerciseId);

  const none = t("cu.stats.noValue");
  const facts: [string, string][] = [];
  if (planItem) {
    if (planItem.sets) facts.push([t("ex.sets"), String(planItem.sets)]);
    if (planItem.reps) facts.push([t("ex.reps"), String(planItem.reps)]);
    if (planItem.durationSeconds) facts.push([t("ex.duration"), formatSeconds(planItem.durationSeconds, locale)]);
    if (planItem.restSeconds) facts.push([t("ex.rest"), formatSeconds(planItem.restSeconds, locale)]);
  }

  return (
    <div className={s.stack}>
      <PageHeader title={exercise.name} actions={back} />
      {exercise.needsTrainerReview && <p><Badge tone="warn">{t("wk.draft")}</Badge></p>}

      <Card title={t("ex.inPlan")}>
        {planItem ? (
          <div className={s.stack}>
            <p className={s.meta}>{planItem.planTitle}</p>
            <dl className={s.facts}>
              {facts.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            {planItem.notes && (
              <p className={s.quote}>
                <span className="sr-only">{t("cu.item.coachNote")}: </span>
                {planItem.notes}
              </p>
            )}
          </div>
        ) : (
          <p className="muted">{t("ex.notInPlan")}</p>
        )}
      </Card>

      <Card title={t("wk.instructions")}>
        {exercise.instructions.length > 0 ? (
          <ol className={s.steps}>
            {exercise.instructions.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        ) : (
          <p className="muted">{t("ex.noInstructions")}</p>
        )}
      </Card>

      <Card>
        <dl className={s.facts}>
          <div>
            <dt>{t("ex.equipment")}</dt>
            <dd>{exercise.equipment ?? t("ex.bodyweight")}</dd>
          </div>
          <div>
            <dt>{t("ex.level")}</dt>
            <dd>{exercise.level ?? none}</dd>
          </div>
          <div>
            <dt>{t("ex.category")}</dt>
            <dd>{exercise.category ?? none}</dd>
          </div>
        </dl>
        <h3 className={s.meta}>{t("wk.primary")}</h3>
        <ul className={s.chips}>
          {exercise.primaryMuscles.map((m) => (
            <li key={m}><Badge tone="info">{m}</Badge></li>
          ))}
        </ul>
        {exercise.secondaryMuscles.length > 0 && (
          <>
            <h3 className={s.meta}>{t("wk.secondary")}</h3>
            <ul className={s.chips}>
              {exercise.secondaryMuscles.map((m) => (
                <li key={m}><Badge>{m}</Badge></li>
              ))}
            </ul>
          </>
        )}
        {exercise.licence && <p className="small muted">{t("wk.licence", { licence: exercise.licence })}</p>}
      </Card>
    </div>
  );
}
