import { notFound } from "next/navigation";
import { ScheduleForm } from "@/components/sessions/ScheduleForm";
import { ButtonLink } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { ErrorState } from "@/components/ui/States";
import { listBatches } from "@/lib/api/batches";
import { listMembers } from "@/lib/api/members";
import { ApiError } from "@/lib/auth/errors";
import { checkRole } from "@/lib/auth/guard";
import { getT } from "@/lib/i18n/server";
import { isRole } from "@/lib/nav";
import type { BatchOption, MemberChoice } from "@/lib/sessions/types";
import { isDateString, istDate } from "@/lib/sessions/week";
import { getViewer } from "@/lib/viewer";

/** Schedule a session for one of the coach's own batches, or a one-on-one with one of their members. */
export default async function NewSessionPage({ params, searchParams }: { params: Promise<{ role: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { role } = await params;
  if (!isRole(role) || role !== "coach") notFound();
  const sp = await searchParams;
  const { t } = await getT();
  const { db, principal } = await getViewer();
  if (principal.role !== "coach") notFound();
  checkRole(principal, "createSession");

  let batches: BatchOption[] | null = null;
  let members: MemberChoice[] = [];
  try {
    const b = await listBatches(db, principal, new URLSearchParams({ limit: "100" }));
    batches = b.items.filter((x) => x.isGroupClass).map((x) => ({ id: x.id, name: x.name, capacity: x.capacity }));
    const m = await listMembers(db, principal, new URLSearchParams({ limit: "100", status: "active" }));
    members = m.items.map((x) => ({ id: x.id, name: x.name }));
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
  }
  const date = typeof sp.date === "string" && isDateString(sp.date) ? sp.date : istDate(new Date());

  return (
    <>
      <PageHeader title={t("sess.schedule.title")} subtitle={t("sess.schedule.subtitle")} actions={<ButtonLink variant="ghost" href={`/${role}/today`}>{t("sess.back")}</ButtonLink>} />
      {batches ? <ScheduleForm role={role} batches={batches} members={members} defaultDate={date} /> : <ErrorState title={t("ui.errorTitle")} message={t("today.loadError")} />}
    </>
  );
}
