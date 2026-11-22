import { notFound, redirect } from "next/navigation";
import { isRole } from "@/lib/nav";

// Each role's home is its real landing screen: the owner dashboard, the coach's Today, the customer's Home.
// The layout guard has already ensured this is the user's own role.
const LANDING = { owner: "/owner/dashboard", coach: "/coach/today", customer: "/customer/home" } as const;

export default async function RoleHome({ params }: { params: Promise<{ role: string }> }) {
  const { role } = await params;
  if (!isRole(role)) notFound();
  redirect(LANDING[role]);
}
