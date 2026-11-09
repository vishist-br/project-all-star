import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "../db";
import { forTenant } from "../tenant-scope";
import { ApiError } from "./errors";
import { buildMe, type Me } from "./me";
import { hashToken, newToken } from "./tokens";

export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
export const ACCESS_TTL_MS = 60 * 60 * 1000;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type Tokens = { accessToken: string; refreshToken: string; expiresInSeconds: number };
export type SignInResult = Tokens & { user: Me };

const INVALID = "This link is invalid, expired or already used";

/**
 * Create a single-use magic link for an existing user. The raw token is returned once and
 * only its hash is stored. Delivery (WhatsApp/SMS) is out of scope: the caller shows or
 * logs the URL in dev only.
 */
export async function createMagicLink(
  userId: string,
  tenantId: string,
  opts: { now?: Date; ttlMs?: number; baseUrl?: string; client?: PrismaClient } = {},
): Promise<{ url: string; token: string; expiresAt: Date }> {
  const now = opts.now ?? new Date();
  const db = forTenant(opts.client ?? defaultPrisma, tenantId);
  const user = await db.user.findFirst({ where: { id: userId }, select: { id: true } });
  if (!user) throw new ApiError("not_found", "User not found");
  const token = newToken();
  const expiresAt = new Date(now.getTime() + (opts.ttlMs ?? MAGIC_LINK_TTL_MS));
  await db.magicLink.create({ data: { tenantId, userId, tokenHash: hashToken(token), expiresAt } });
  const base = opts.baseUrl ?? process.env.APP_BASE_URL ?? "http://localhost:3000";
  return { url: `${base}/auth/magic?token=${token}`, token, expiresAt };
}

async function issueSession(
  client: PrismaClient,
  tenantId: string,
  userId: string,
  now: Date,
): Promise<Tokens> {
  const accessToken = newToken();
  const refreshToken = newToken();
  await forTenant(client, tenantId).authSession.create({
    data: {
      tenantId,
      userId,
      accessHash: hashToken(accessToken),
      refreshHash: hashToken(refreshToken),
      accessExpiresAt: new Date(now.getTime() + ACCESS_TTL_MS),
      refreshExpiresAt: new Date(now.getTime() + REFRESH_TTL_MS),
    },
  });
  return { accessToken, refreshToken, expiresInSeconds: ACCESS_TTL_MS / 1000 };
}

/**
 * Exchange a magic-link token for a session scoped to the link's user, tenant and role.
 * Single use: the claim is one atomic UPDATE ... WHERE used_at IS NULL AND not expired,
 * so concurrent or repeated exchanges cannot both succeed.
 */
export async function exchangeMagicLink(
  token: string,
  opts: { now?: Date; client?: PrismaClient } = {},
): Promise<SignInResult> {
  const client = opts.client ?? defaultPrisma;
  const now = opts.now ?? new Date();
  if (typeof token !== "string" || token.length === 0 || token.length > 200) {
    throw new ApiError("unauthorized", INVALID);
  }
  const tokenHash = hashToken(token);
  // The tenant is unknown until the token is found, so this one lookup uses the base client.
  const link = await client.magicLink.findUnique({ where: { tokenHash } });
  if (!link) throw new ApiError("unauthorized", INVALID);
  const claimed = await forTenant(client, link.tenantId).magicLink.updateMany({
    where: { id: link.id, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  if (claimed.count !== 1) throw new ApiError("unauthorized", INVALID);
  const me = await buildMe(client, link.tenantId, link.userId);
  if (!me) throw new ApiError("unauthorized", INVALID);
  const tokens = await issueSession(client, link.tenantId, link.userId, now);
  return { ...tokens, user: me };
}

/** Rotate tokens: the old refresh token stops working as soon as a new pair is issued. */
export async function refreshSession(
  refreshToken: string,
  opts: { now?: Date; client?: PrismaClient } = {},
): Promise<Tokens> {
  const client = opts.client ?? defaultPrisma;
  const now = opts.now ?? new Date();
  const fail = () => new ApiError("unauthorized", "Missing, expired or invalid credentials");
  if (typeof refreshToken !== "string" || refreshToken.length === 0 || refreshToken.length > 200) throw fail();
  const session = await client.authSession.findUnique({ where: { refreshHash: hashToken(refreshToken) } });
  if (!session) throw fail();
  const revoked = await forTenant(client, session.tenantId).authSession.updateMany({
    where: { id: session.id, revokedAt: null, refreshExpiresAt: { gt: now } },
    data: { revokedAt: now },
  });
  if (revoked.count !== 1) throw fail();
  const user = await forTenant(client, session.tenantId).user.findFirst({ where: { id: session.userId } });
  if (!user) throw fail();
  return issueSession(client, session.tenantId, session.userId, now);
}

export async function signOut(accessToken: string, client: PrismaClient = defaultPrisma): Promise<void> {
  const session = await client.authSession.findUnique({ where: { accessHash: hashToken(accessToken) } });
  if (!session) return;
  await forTenant(client, session.tenantId).authSession.updateMany({
    where: { id: session.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
