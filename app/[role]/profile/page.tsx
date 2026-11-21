import { notFound } from "next/navigation";
import SectionPage from "../[section]/page";
import { ProfileScreen } from "@/components/customer/progress/ProfileScreen";
import { isRole } from "@/lib/nav";

export const dynamic = "force-dynamic";

/** Customers: their own profile (display only). Other roles keep the generic section page. */
export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ role: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { role } = await params;
  if (!isRole(role)) notFound();
  if (role !== "customer") return SectionPage({ params: Promise.resolve({ role, section: "profile" }), searchParams });
  return <ProfileScreen />;
}
