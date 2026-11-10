import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { NotAllowed } from "@/components/NotAllowed";
import { canViewRole } from "@/lib/guard";
import { isRole } from "@/lib/nav";
import { getSession } from "@/lib/session";

/**
 * Route guard: a user sees only their own role's screens. Another role's URL shows the
 * not-allowed page inside the user's own shell (their nav, never the other role's).
 * getSession() resolves the real session (or the demo switcher in demo mode) and sends visitors
 * with no session to /sign-in.
 */
export default async function RoleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ role: string }>;
}) {
  const { role } = await params;
  if (!isRole(role)) notFound();
  const session = await getSession();
  if (!canViewRole(session.role, role)) {
    return (
      <AppShell role={session.role}>
        <NotAllowed role={session.role} />
      </AppShell>
    );
  }
  return <AppShell role={role}>{children}</AppShell>;
}
