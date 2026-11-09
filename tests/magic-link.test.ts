import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createMagicLink, exchangeMagicLink, refreshSession, signOut, MAGIC_LINK_TTL_MS } from "../lib/auth/magic-link";
import { resolvePrincipal } from "../lib/auth/session";
import { hashToken } from "../lib/auth/tokens";
import { tryConnect } from "./helpers-db";

describe("magic-link sign-in (local Postgres)", () => {
  let prisma: PrismaClient | null = null;
  const sfx = Date.now().toString(36);
  let tenantId = "";
  let otherTenantId = "";
  const users: Record<string, string> = {};

  const req = (token: string) => new Request("http://x/api/v1/me", { headers: { authorization: `Bearer ${token}` } });

  beforeAll(async () => {
    prisma = await tryConnect();
    if (!prisma) return;
    tenantId = (await prisma.tenant.create({ data: { slug: `ml-a-${sfx}`, name: "A" } })).id;
    otherTenantId = (await prisma.tenant.create({ data: { slug: `ml-b-${sfx}`, name: "B" } })).id;
    for (const [key, role] of [["owner", "OWNER"], ["coach", "COACH"], ["customer", "CUSTOMER"]] as const) {
      users[key] = (await prisma.user.create({ data: { tenantId, role, email: `${key}@a.test`, name: key } })).id;
    }
  });

  afterAll(async () => {
    if (!prisma) return;
    for (const id of [tenantId, otherTenantId]) {
      await prisma.magicLink.deleteMany({ where: { tenantId: id } });
      await prisma.authSession.deleteMany({ where: { tenantId: id } });
    }
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
    await prisma.$disconnect();
  });

  it("creates a link, stores only the hash, and exchanges it for a session scoped to tenant and role", async (ctx) => {
    if (!prisma) return ctx.skip();
    const link = await createMagicLink(users.coach, tenantId, { baseUrl: "http://app.test" });
    expect(link.url).toBe(`http://app.test/auth/magic?token=${link.token}`);
    const stored = await prisma.magicLink.findMany({ where: { tenantId, userId: users.coach } });
    expect(stored).toHaveLength(1);
    expect(stored[0].tokenHash).toBe(hashToken(link.token));
    expect(JSON.stringify(stored[0])).not.toContain(link.token);

    const result = await exchangeMagicLink(link.token);
    expect(result.user).toMatchObject({ id: users.coach, role: "coach", tenantId, coachId: users.coach });
    const sessions = await prisma.authSession.findMany({ where: { tenantId, userId: users.coach } });
    expect(JSON.stringify(sessions)).not.toContain(result.accessToken);
    expect(JSON.stringify(sessions)).not.toContain(result.refreshToken);

    const principal = await resolvePrincipal(req(result.accessToken));
    expect(principal).toEqual({ userId: users.coach, tenantId, role: "coach" });
  });

  it("rejects a reused link", async (ctx) => {
    if (!prisma) return ctx.skip();
    const link = await createMagicLink(users.owner, tenantId);
    await exchangeMagicLink(link.token);
    await expect(exchangeMagicLink(link.token)).rejects.toMatchObject({ code: "unauthorized", status: 401 });
  });

  it("only one of two concurrent exchanges succeeds", async (ctx) => {
    if (!prisma) return ctx.skip();
    const link = await createMagicLink(users.owner, tenantId);
    const results = await Promise.allSettled([exchangeMagicLink(link.token), exchangeMagicLink(link.token)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("rejects an expired link and an unknown token", async (ctx) => {
    if (!prisma) return ctx.skip();
    const past = new Date(Date.now() - 2 * MAGIC_LINK_TTL_MS);
    const link = await createMagicLink(users.owner, tenantId, { now: past });
    await expect(exchangeMagicLink(link.token)).rejects.toMatchObject({ code: "unauthorized" });
    await expect(exchangeMagicLink("not-a-real-token")).rejects.toMatchObject({ code: "unauthorized" });
    await expect(exchangeMagicLink("")).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("cannot create a link for a user of another tenant", async (ctx) => {
    if (!prisma) return ctx.skip();
    await expect(createMagicLink(users.owner, otherTenantId)).rejects.toMatchObject({ code: "not_found" });
  });

  it("customer session carries linked member ids", async (ctx) => {
    if (!prisma) return ctx.skip();
    const member = await prisma.member.create({ data: { tenantId, displayName: "Fake Adult", userId: users.customer } });
    const { user } = await exchangeMagicLink((await createMagicLink(users.customer, tenantId)).token);
    expect(user.role).toBe("customer");
    expect(user.memberIds).toEqual([member.id]);
  });

  it("access tokens expire, refresh rotates, sign-out revokes", async (ctx) => {
    if (!prisma) return ctx.skip();
    const s = await exchangeMagicLink((await createMagicLink(users.owner, tenantId)).token);
    const later = new Date(Date.now() + 2 * 60 * 60 * 1000);
    expect(await resolvePrincipal(req(s.accessToken), { now: later })).toBeNull();

    const next = await refreshSession(s.refreshToken);
    await expect(refreshSession(s.refreshToken)).rejects.toMatchObject({ code: "unauthorized" });
    expect(await resolvePrincipal(req(s.accessToken))).toBeNull(); // old pair revoked
    expect((await resolvePrincipal(req(next.accessToken)))?.role).toBe("owner");

    await signOut(next.accessToken);
    expect(await resolvePrincipal(req(next.accessToken))).toBeNull();
    expect(await resolvePrincipal(new Request("http://x"))).toBeNull();
    expect(await resolvePrincipal(req("garbage"))).toBeNull();
  });
});
