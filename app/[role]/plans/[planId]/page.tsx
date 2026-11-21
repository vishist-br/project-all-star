import { notFound } from "next/navigation";
import { PlanBuilder } from "@/components/plans/PlanBuilder";
import s from "@/components/plans/plans.module.css";
import { ButtonLink } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { getWorkoutPlan } from "@/lib/api/workout-plans";
import { ApiError } from "@/lib/auth/errors";
import { checkRole } from "@/lib/auth/guard";
import { getT } from "@/lib/i18n/server";
import { isRole } from "@/lib/nav";
import { loadExerciseFacets } from "@/lib/plans/facets";
import { getViewer } from "@/lib/viewer";

export default async function EditPlanPage({ params }: { params: Promise<{ role: string; planId: string }> }) {
  const { role, planId } = await params;
  if (!isRole(role) || role === "customer") notFound();
  const { t } = await getT();
  const { db, principal } = await getViewer();
  // The role layout already shows "not available" to other roles; stop quietly here instead of throwing.
  if (principal.role === "customer") notFound();
  checkRole(principal, "updateWorkoutPlan");

  let plan: Awaited<ReturnType<typeof getWorkoutPlan>>;
  try {
    plan = await getWorkoutPlan(db, principal, planId);
  } catch (err) {
    if (err instanceof ApiError && err.code === "not_found") notFound();
    if (err instanceof ApiError && err.code === "forbidden") {
      return <Notice title={t("plans.builder.editTitle")} text={t("plans.builder.notYours")} href={`/${role}/plans`} back={t("plans.backToList")} />;
    }
    throw err;
  }
  const mine = principal.role === "owner" || plan.coachId === principal.userId;
  if (!mine) return <Notice title={plan.title} text={t("plans.builder.notYours")} href={`/${role}/plans`} back={t("plans.backToList")} />;
  if (plan.status === "archived") {
    return <Notice title={plan.title} text={t("plans.builder.archivedNotice")} href={`/${role}/plans`} back={t("plans.backToList")} />;
  }

  return (
    <>
      <PageHeader title={t("plans.builder.editTitle")} subtitle={plan.title} />
      <PlanBuilder role={role} plan={plan} facets={await loadExerciseFacets(db)} />
    </>
  );
}

function Notice({ title, text, href, back }: { title: string; text: string; href: string; back: string }) {
  return (
    <>
      <PageHeader title={title} />
      <div className={s.notice} role="status">
        <p>{text}</p>
        <div className="actions"><ButtonLink variant="secondary" href={href}>{back}</ButtonLink></div>
      </div>
    </>
  );
}
