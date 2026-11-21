import { notFound } from "next/navigation";
import { DashboardContent, type DashboardData, type Settled } from "@/components/owner/dashboard/Dashboard";
import { parseRangeDays, rangeFor } from "@/components/owner/dashboard/view-model";
import { NotAllowed } from "@/components/NotAllowed";
import { getCoachWorkload, getFeeStats, getOwnerInsights, getOwnerOverview, getOwnerTrends } from "@/lib/api/analytics";
import { tenantDate } from "@/lib/api/pagination";
import { checkRole } from "@/lib/auth/guard";
import { getT } from "@/lib/i18n/server";
import { isRole } from "@/lib/nav";
import { getViewer } from "@/lib/viewer";

const TREND_WEEKS = "12";

async function settle<T>(run: () => Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (err) {
    console.error("owner dashboard panel failed", err instanceof Error ? err.message : err);
    return { ok: false };
  }
}

/**
 * Owner analytics dashboard. Server component: calls the same lib/api/analytics functions as the
 * /api/v1/analytics routes, as the signed-in viewer. Each panel fails on its own with a retry link.
 */
export default async function DashboardPage({ params, searchParams }: { params: Promise<{ role: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { role } = await params;
  if (!isRole(role)) notFound();
  const sp = await searchParams;
  const { t, locale } = await getT();
  const { principal, db } = await getViewer();
  if (principal.role !== "owner" || role !== "owner") return <NotAllowed role={principal.role} />;
  checkRole(principal, "getOwnerOverview");

  const now = new Date();
  const days = parseRangeDays(sp.range);
  const { from, to } = rangeFor(tenantDate(now), days);
  const rangeQuery = new URLSearchParams({ from, to });
  const trendQuery = new URLSearchParams({ granularity: "week", periods: TREND_WEEKS });

  const [overview, trends, fees, insights, workload] = await Promise.all([
    settle(() => getOwnerOverview(db, rangeQuery, now)),
    settle(() => getOwnerTrends(db, trendQuery, now)),
    settle(() => getFeeStats(db, now)),
    settle(() => getOwnerInsights(db, now)),
    settle(() => getCoachWorkload(db, rangeQuery, now)),
  ]);
  const data: DashboardData = { days, from, to, overview, trends, fees, insights, workload };
  return <DashboardContent data={data} t={t} locale={locale} />;
}
