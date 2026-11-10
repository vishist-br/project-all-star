import { cache } from "react";
import { cookies } from "next/headers";
import { prisma } from "./db";
import { ACCESS_COOKIE } from "./auth-cookies";
import type { Principal } from "./auth/principal";
import { toDbRole } from "./auth/roles";
import { resolvePrincipal } from "./auth/session";
import { getSession, type Session } from "./session";
import { forTenant } from "./tenant-scope";

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
      principal = await resolvePrincipal(
        new Request("http://internal.invalid/", { headers: { authorization: `Bearer ${access}` } }),
      );
    }
  } else {
    const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug }, select: { id: true } });
    const user = tenant
      ? await prisma.user.findFirst({
          where: { tenantId: tenant.id, role: toDbRole(session.role) },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        })
      : null;
    if (tenant && user) principal = { userId: user.id, tenantId: tenant.id, role: session.role };
  }
  if (!principal) throw new Error("No viewer for this session");
  return { session, principal, db: forTenant(prisma, principal.tenantId) };
});
