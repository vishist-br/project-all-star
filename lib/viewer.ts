import { cache } from "react";
import { cookies } from "next/headers";
import { prisma } from "./db";
import { ACCESS_COOKIE } from "./auth-cookies";
import type { Principal } from "./auth/principal";
import { toDbRole } from "./auth/roles";
import { getSession, principalForToken, type Session } from "./session";
import { forTenant } from "./tenant-scope";

/**
 * The seeded user a demo role stands in as. Owners and coaches: the oldest user of that role.
 * Customers: a user whose own member profile, or whose children's, is active, preferring one with
 * an active plan assignment, so the demo shows real data instead of "no profile linked".
 */
export async function demoUserFor(tenantId: string, role: Principal["role"]): Promise<{ id: string } | null> {
  const dbRole = toDbRole(role);
  if (role === "customer") {
    const linked = { tenantId, isActive: true, OR: [{ user: { role: dbRole } }, { guardian: { user: { role: dbRole } } }] };
    const pick = async (extra: object) => {
      const m = await prisma.member.findFirst({
        where: { ...linked, ...extra },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { userId: true, guardian: { select: { userId: true } } },
      });
      const id = m?.userId ?? m?.guardian?.userId ?? null;
      return id ? { id } : null;
    };
    const found = (await pick({ assignments: { some: { status: "ACTIVE" } } })) ?? (await pick({}));
    if (found) return found;
  }
  return prisma.user.findFirst({ where: { tenantId, role: dbRole }, orderBy: { createdAt: "asc" }, select: { id: true } });
}

/**
 * The signed-in caller as the API sees them: principal (tenant and role from the session) and a
 * tenant-scoped client. Server screens use this to call the same lib/api functions as the
 * /api/v1 routes. In demo mode with no real session, the seeded user for the demo role stands in.
 */
export const getViewer = cache(async (): Promise<{ session: Session; principal: Principal; db: ReturnType<typeof forTenant> }> => {
  const session = await getSession();
  let principal: Principal | null = null;
  if (session.source === "real") {
    const access = (await cookies()).get(ACCESS_COOKIE)?.value;
    if (access) {
      principal = await principalForToken(access);
    }
  } else {
    const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug }, select: { id: true } });
    const user = tenant ? await demoUserFor(tenant.id, session.role) : null;
    if (tenant && user) principal = { userId: user.id, tenantId: tenant.id, role: session.role };
  }
  if (!principal) throw new Error("No viewer for this session");
  return { session, principal, db: forTenant(prisma, principal.tenantId) };
});
