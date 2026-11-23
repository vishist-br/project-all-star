import { notFound } from "next/navigation";
import { WeekScreen } from "@/components/progress-card/WeekScreen";
import { isRole } from "@/lib/nav";

export const dynamic = "force-dynamic";

/** Customers: the weekly progress card to print or share (/customer/progress/week). Other roles get a 404. */
export default async function WeekPage({
  params,
  searchParams,
}: {
  params: Promise<{ role: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { role } = await params;
  if (!isRole(role) || role !== "customer") notFound();
  const sp = await searchParams;
  return <WeekScreen week={typeof sp.week === "string" ? sp.week : undefined} />;
}
