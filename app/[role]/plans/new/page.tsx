import { notFound } from "next/navigation";
import { PlanBuilder } from "@/components/plans/PlanBuilder";
import { PageHeader } from "@/components/ui/PageHeader";
import { checkRole } from "@/lib/auth/guard";
import { getT } from "@/lib/i18n/server";
import { isRole } from "@/lib/nav";
import { loadExerciseFacets } from "@/lib/plans/facets";
import { getViewer } from "@/lib/viewer";

export default async function NewPlanPage({ params }: { params: Promise<{ role: string }> }) {
  const { role } = await params;
  if (!isRole(role) || role === "customer") notFound();
  const { t } = await getT();
  const { db, principal } = await getViewer();
  // The role layout already shows "not available" to other roles; stop quietly here instead of throwing.
  if (principal.role === "customer") notFound();
  checkRole(principal, "createWorkoutPlan");
  return (
    <>
      <PageHeader title={t("plans.builder.newTitle")} />
      <PlanBuilder role={role} facets={await loadExerciseFacets(db)} />
    </>
  );
}
