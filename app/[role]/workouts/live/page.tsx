import { notFound } from "next/navigation";
import { NoMember } from "@/components/customer/NoMember";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/States";
import { PageHeader } from "@/components/ui/PageHeader";
import { LiveWorkout } from "@/components/workout/LiveWorkout";
import { loadLiveWorkout } from "@/lib/customer/live";
import { allow, getCustomerContext } from "@/lib/customer/server";
import { getT } from "@/lib/i18n/server";
import { isRole } from "@/lib/nav";

export const dynamic = "force-dynamic";

/** The member's focused logging screen for today's plan. Customers only; reached from Workouts. */
export default async function LiveWorkoutPage({ params }: { params: Promise<{ role: string }> }) {
  const { role } = await params;
  if (!isRole(role) || role !== "customer") notFound();
  const { t } = await getT();
  const ctx = await getCustomerContext();
  if (!ctx.selected) return <NoMember />;
  allow(ctx.principal, "getMemberSchedule");
  allow(ctx.principal, "recordWorkoutSets");
  const data = await loadLiveWorkout(ctx.db, ctx.principal, ctx.selected.id, ctx.today);
  const back = "/customer/workouts";
  if (data.items.length === 0) {
    return (
      <>
        <PageHeader title={t("lw.title")} />
        <EmptyState
          title={t("lw.empty.title")}
          text={t("lw.empty.body")}
          icon="✚"
          action={<ButtonLink href={back} variant="secondary">{t("lw.back")}</ButtonLink>}
        />
      </>
    );
  }
  return <LiveWorkout data={data} backHref={back} />;
}
