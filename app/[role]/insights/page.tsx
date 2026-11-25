import { notFound } from "next/navigation";
import { InsightsScreen } from "@/components/owner/insights/InsightsScreen";
import { NotAllowed } from "@/components/NotAllowed";
import { getClassInsights } from "@/lib/api/class-insights";
import { checkRole } from "@/lib/auth/guard";
import { ErrorState } from "@/components/ui/States";
import { getT } from "@/lib/i18n/server";
import { parseInsightRange, type Insights } from "@/lib/insights/view";
import { isRole } from "@/lib/nav";
import { getViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

/** Owner: how group classes are filling, attendance, waitlists and plain suggestions. */
export default async function InsightsPage({ params, searchParams }: { params: Promise<{ role: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { role } = await params;
  if (!isRole(role) || role !== "owner") notFound();
  const sp = await searchParams;
  const range = parseInsightRange(sp.range);
  const { t, locale } = await getT();
  const { principal, db } = await getViewer();
  if (principal.role !== "owner") return <NotAllowed role={principal.role} />;
  checkRole(principal, "getClassInsights");
  let data: Insights;
  try {
    data = (await getClassInsights(db, new URLSearchParams({ range }))) as unknown as Insights;
  } catch (err) {
    console.error("class insights failed", err instanceof Error ? err.message : err);
    return (
      <>
        <ErrorState title={t("oi.error.title")} message={t("oi.error.body")} />
        <p><a className="btn btn-secondary" href={range === "28d" ? "/owner/insights" : `/owner/insights?range=${range}`}>{t("ui.retry")}</a></p>
      </>
    );
  }
  return <InsightsScreen data={data} range={range} t={t} locale={locale} />;
}
