import { notFound } from "next/navigation";
import { AvailabilityEditor } from "@/components/sessions/AvailabilityEditor";
import { SessionTabs } from "@/components/sessions/SessionTabs";
import { PageHeader } from "@/components/ui/PageHeader";
import { ErrorState } from "@/components/ui/States";
import { listCoachAvailability } from "@/lib/api/availability";
import { ApiError } from "@/lib/auth/errors";
import { checkRole } from "@/lib/auth/guard";
import { getT } from "@/lib/i18n/server";
import { isRole } from "@/lib/nav";
import { getViewer } from "@/lib/viewer";

export default async function AvailabilityPage({ params }: { params: Promise<{ role: string }> }) {
  const { role } = await params;
  if (!isRole(role) || role !== "coach") notFound();
  const { t } = await getT();
  const { db, principal } = await getViewer();
  if (principal.role !== "coach") notFound();
  checkRole(principal, "listCoachAvailability");

  let slots: { weekday: number; startTime: string; endTime: string; venueId: string | null }[] | null = null;
  try {
    slots = (await listCoachAvailability(db, principal, principal.userId)).slots;
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
  }
  return (
    <>
      <PageHeader title={t("today.title")} subtitle={t("avail.title")} />
      <SessionTabs role={role} active="availability" />
      {slots ? <AvailabilityEditor initial={slots} /> : <ErrorState title={t("ui.errorTitle")} message={t("today.loadError")} />}
    </>
  );
}
