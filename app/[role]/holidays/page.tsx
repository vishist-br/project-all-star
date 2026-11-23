import { notFound } from "next/navigation";
import { NotAllowed } from "@/components/NotAllowed";
import { HolidayEditor } from "@/components/owner/holidays/HolidayEditor";
import { PageHeader } from "@/components/ui/PageHeader";
import { ErrorState } from "@/components/ui/States";
import { listHolidays } from "@/lib/api/holidays";
import { checkRole } from "@/lib/auth/guard";
import { getT } from "@/lib/i18n/server";
import { isRole } from "@/lib/nav";
import { addDays, istDate } from "@/lib/sessions/week";
import { getViewer } from "@/lib/viewer";

/** Owner holiday and closure calendar for visibility: days with no expected sessions. Owner only. */
export default async function HolidaysPage({ params }: { params: Promise<{ role: string }> }) {
  const { role } = await params;
  if (!isRole(role)) notFound();
  const { t } = await getT();
  const { principal, db } = await getViewer();
  if (principal.role !== "owner" || role !== "owner") return <NotAllowed role={principal.role} />;
  checkRole(principal, "listHolidays");

  const today = istDate(new Date());
  const from = addDays(today, -180);
  let items: Awaited<ReturnType<typeof listHolidays>>["items"] | null = null;
  try {
    items = (await listHolidays(db, new URLSearchParams({ from, limit: "100" }))).items;
  } catch (err) {
    console.error("owner holidays failed", err instanceof Error ? err.message : err);
  }
  return (
    <section>
      <PageHeader title={t("hol.title")} />
      {items ? <HolidayEditor initial={items} today={today} /> : <ErrorState title={t("hol.fail")} />}
    </section>
  );
}
