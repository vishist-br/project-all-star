import type { PrismaClient } from "@prisma/client";
import { forTenant } from "../tenant-scope";
import { toApiRole, type ApiRole } from "./roles";

/** The `Me` schema in docs/api/openapi.yaml. */
export type Me = {
  id: string;
  role: ApiRole;
  name: string;
  tenantId: string;
  tenantSlug: string;
  memberIds?: string[];
  coachId?: string | null;
  locale?: "en" | "hi" | "kn";
};

export async function buildMe(client: PrismaClient, tenantId: string, userId: string): Promise<Me | null> {
  const db = forTenant(client, tenantId);
  const user = await db.user.findFirst({ where: { id: userId } });
  const tenant = await client.tenant.findUnique({ where: { id: tenantId } });
  if (!user || !tenant) return null;
  const role = toApiRole(user.role);
  const me: Me = { id: user.id, role, name: user.name, tenantId, tenantSlug: tenant.slug };
  if (role === "customer") {
    const members = await db.member.findMany({
      where: { OR: [{ userId }, { guardian: { userId } }] },
      select: { id: true },
    });
    me.memberIds = members.map((m) => m.id);
  }
  if (role === "coach") me.coachId = user.id;
  return me;
}
