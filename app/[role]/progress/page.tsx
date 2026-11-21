import { notFound } from "next/navigation";
import SectionPage from "../[section]/page";
import { ProgressScreen } from "@/components/customer/progress/ProgressScreen";
import { isRole } from "@/lib/nav";

export const dynamic = "force-dynamic";

/** Customers: level, goals, attendance, streaks, charts and history. Other roles keep the generic section page. */
export default async function ProgressPage({
  params,
  searchParams,
}: {
  params: Promise<{ role: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { role } = await params;
  if (!isRole(role)) notFound();
  if (role !== "customer") return SectionPage({ params: Promise.resolve({ role, section: "progress" }), searchParams });
  return <ProgressScreen searchParams={await searchParams} />;
}
