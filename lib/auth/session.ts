import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "../db";
import { forTenant } from "../tenant-scope";
import type { Principal } from "./principal";
import { toApiRole } from "./roles";
import { hashToken } from "./tokens";

export function bearerToken(request: Request): string | null {
  const h = request.headers.get("authorization");
  const m = h ? /^Bearer\s+(\S+)$/i.exec(h) : null;
  return m ? m[1] : null;
}

/**
 * Resolves the caller from `Authorization: Bearer <accessToken>`. The tenant and role come
 * from the stored session and user, never from anything the client sends.
 */
export async function resolvePrincipal(
  request: Request,
  opts: { now?: Date; client?: PrismaClient } = {},
): Promise<Principal | null> {
  const token = bearerToken(request);
  if (!token || token.length > 200) return null;
  const client = opts.client ?? defaultPrisma;
  const now = opts.now ?? new Date();
  const session = await client.authSession.findUnique({ where: { accessHash: hashToken(token) } });
  if (!session || session.revokedAt || session.accessExpiresAt <= now) return null;
  const user = await forTenant(client, session.tenantId).user.findFirst({ where: { id: session.userId } });
  if (!user) return null;
  return { userId: user.id, tenantId: user.tenantId, role: toApiRole(user.role) };
}
