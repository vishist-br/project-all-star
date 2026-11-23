import { notFound } from "next/navigation";
import { AbsencesScreen } from "@/components/customer/absences/AbsencesScreen";
import { isRole } from "@/lib/nav";

export const dynamic = "force-dynamic";

/** Customers: tell the coach ahead of time about a missed session or date range. Other roles get a 404. */
export default async function AbsencesPage({
  params,
  searchParams,
}: {
  params: Promise<{ role: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { role } = await params;
  if (!isRole(role) || role !== "customer") notFound();
  const sp = await searchParams;
  return <AbsencesScreen sessionId={typeof sp.session === "string" ? sp.session : undefined} />;
}
