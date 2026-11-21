import { notFound } from "next/navigation";
import SectionPage from "../[section]/page";
import { ScheduleScreen } from "@/components/customer/schedule/ScheduleScreen";
import { isRole } from "@/lib/nav";

export const dynamic = "force-dynamic";

/** Customers: their schedule with booking and waiting list. Other roles keep the generic section page. */
export default async function SchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ role: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { role } = await params;
  if (!isRole(role)) notFound();
  if (role !== "customer") return SectionPage({ params: Promise.resolve({ role, section: "schedule" }), searchParams });
  return <ScheduleScreen searchParams={await searchParams} />;
}
