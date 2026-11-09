import { redirect, notFound } from "next/navigation";
import { NAV, isRole } from "@/lib/nav";

export default async function RoleHome({ params }: { params: Promise<{ role: string }> }) {
  const { role } = await params;
  if (!isRole(role)) notFound();
  redirect(`/${role}/${NAV[role][0].section}`);
}
