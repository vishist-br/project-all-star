import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { hashToken } from "../lib/auth/tokens";
import { exchangeMagicLink, MAGIC_LINK_TTL_MS } from "../lib/auth/magic-link";
import { seedDemo } from "../prisma/seed/demo";
import { TENANTS } from "../prisma/seed/data";
import { tryConnect } from "./helpers-db";
import { validateSchemaName } from "./contract-schema";
import { POST as createLink } from "../app/api/v1/members/[memberId]/magic-link/route";

describe("POST /members/{memberId}/magic-link (local Postgres, seeded demo data)", () => {
  let prisma: PrismaClient | null = null;
  const tokens: Record<string, string> = {};
  const sessionIds: string[] = [];
  let karateId = "";
  let gymId = "";

  beforeAll(async () => {
    prisma = await tryConnect();
    if (!prisma) return;
    const ids = await seedDemo(prisma);
    karateId = ids[TENANTS.findIndex((t) => t.slug === "demo-karate")];
    gymId = ids[TENANTS.findIndex((t) => t.slug === "demo-gym")];
    const login = async (label: string, tenantId: string, slug: string, key: string) => {
      const user = await prisma!.user.findFirstOrThrow({ where: { tenantId, email: `${key}@${slug}.example.test` } });
      const token = `test-${label}-${Math.random().toString(36).slice(2)}-${Date.now()}`;
      const s = await prisma!.authSession.create({
        data: {
          tenantId,
          userId: user.id,
          accessHash: hashToken(token),
          refreshHash: hashToken(`r-${token}`),
          accessExpiresAt: new Date(Date.now() + 3_600_000),
          refreshExpiresAt: new Date(Date.now() + 7_200_000),
        },
      });
      sessionIds.push(s.id);
      tokens[label] = token;
    };
    await login("owner", karateId, "demo-karate", "owner");
    await login("coach1", karateId, "demo-karate", "c1");
    await login("coach2", karateId, "demo-karate", "c2");
    await login("parent", karateId, "demo-karate", "parent-g1");
    await login("adult", karateId, "demo-karate", "member-a1");
    await login("gymOwner", gymId, "demo-gym", "owner");
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.authSession.deleteMany({ where: { id: { in: sessionIds } } });
      await prisma.$disconnect();
    }
  });

  const post = async (memberId: string, who?: string) => {
    const res = await createLink(
      new Request(`http://localhost/api/v1/members/${memberId}/magic-link`, {
        method: "POST",
        headers: who ? { authorization: `Bearer ${tokens[who]}` } : {},
      }),
      { params: Promise.resolve({ memberId }) },
    );
    return { status: res.status, body: (await res.json()) as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const tokenOf = (url: string) => new URL(url).searchParams.get("token")!;

  async function pick() {
    const coach = await prisma!.user.findFirstOrThrow({ where: { tenantId: karateId, email: "c1@demo-karate.example.test" } });
    const inCoachBatch = { enrollments: { some: { batch: { coachId: coach.id } } } };
    const mine = await prisma!.member.findFirstOrThrow({
      where: { tenantId: karateId, ...inCoachBatch, OR: [{ userId: { not: null } }, { guardian: { userId: { not: null } } }] },
    });
    const notMine = await prisma!.member.findFirstOrThrow({ where: { tenantId: karateId, NOT: inCoachBatch } });
    const kid = await prisma!.member.findFirstOrThrow({
      where: { tenantId: karateId, isMinor: true, guardian: { userId: { not: null } } },
      include: { guardian: true },
    });
    const adult = await prisma!.member.findFirstOrThrow({ where: { tenantId: karateId, userId: { not: null } } });
    return { mine, notMine, kid, adult };
  }

  it("401 without a session, 403 for customers (parent and adult member)", async (ctx) => {
    if (!prisma) return ctx.skip();
    const { adult } = await pick();
    expect((await post(adult.id)).status).toBe(401);
    for (const who of ["parent", "adult"]) {
      const r = await post(adult.id, who);
      expect(r.status).toBe(403);
      expect(validateSchemaName(r.body, "Error")).toEqual([]);
    }
  });

  it("owner gets a link for an adult member and for a kid's parent, in contract shape", async (ctx) => {
    if (!prisma) return ctx.skip();
    const { adult, kid } = await pick();
    const a = await post(adult.id, "owner");
    expect(a.status).toBe(200);
    expect(validateSchemaName(a.body, "MemberMagicLink")).toEqual([]);
    expect(a.body.recipient).toBe("member");
    expect(a.body.url).toMatch(/\/auth\/magic\?token=[^&]+$/);
    const s = await exchangeMagicLink(tokenOf(a.body.url));
    expect(s.user).toMatchObject({ id: adult.userId, role: "customer", tenantId: karateId });

    const k = await post(kid.id, "owner");
    expect(k.status).toBe(200);
    expect(k.body.recipient).toBe("guardian");
    expect((await exchangeMagicLink(tokenOf(k.body.url))).user.id).toBe(kid.guardian!.userId);
  });

  it("stores only the hash, expires in 15 minutes", async (ctx) => {
    if (!prisma) return ctx.skip();
    const { adult } = await pick();
    const before = Date.now();
    const r = await post(adult.id, "owner");
    const token = tokenOf(r.body.url);
    const rows = await prisma.magicLink.findMany({ where: { tokenHash: hashToken(token) } });
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).not.toContain(token);
    const ttl = new Date(r.body.expiresAt).getTime() - before;
    expect(ttl).toBeGreaterThan(MAGIC_LINK_TTL_MS - 5_000);
    expect(ttl).toBeLessThanOrEqual(MAGIC_LINK_TTL_MS + 5_000);
    await expect(
      exchangeMagicLink(token, { now: new Date(Date.now() + MAGIC_LINK_TTL_MS + 60_000) }),
    ).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("is single use", async (ctx) => {
    if (!prisma) return ctx.skip();
    const { adult } = await pick();
    const token = tokenOf((await post(adult.id, "owner")).body.url);
    await exchangeMagicLink(token);
    await expect(exchangeMagicLink(token)).rejects.toMatchObject({ code: "unauthorized", status: 401 });
  });

  it("coach: own-batch member allowed, a member outside their batches is 403", async (ctx) => {
    if (!prisma) return ctx.skip();
    const { mine, notMine } = await pick();
    expect((await post(mine.id, "coach1")).status).toBe(200);
    const denied = await post(notMine.id, "coach1");
    expect(denied.status).toBe(403);
    expect(validateSchemaName(denied.body, "Error")).toEqual([]);
  });

  it("cross-tenant member is 404 and writes no link", async (ctx) => {
    if (!prisma) return ctx.skip();
    const { adult } = await pick();
    const count = await prisma.magicLink.count({ where: { tenantId: gymId } });
    const r = await post(adult.id, "gymOwner");
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe("not_found");
    expect(await prisma.magicLink.count({ where: { tenantId: gymId } })).toBe(count);
    expect((await post("does-not-exist", "owner")).status).toBe(404);
  });

  it("member without a login is 404", async (ctx) => {
    if (!prisma) return ctx.skip();
    // Own scratch tenant: other test files read the shared demo tenants concurrently.
    const sfx = Date.now().toString(36);
    const t = await prisma.tenant.create({ data: { slug: `mml-${sfx}`, name: "Scratch" } });
    try {
      const owner = await prisma.user.create({ data: { tenantId: t.id, role: "OWNER", email: "o@mml.test", name: "o" } });
      const m = await prisma.member.create({ data: { tenantId: t.id, displayName: "Sample No Login" } });
      const token = `test-mml-${sfx}`;
      await prisma.authSession.create({
        data: {
          tenantId: t.id,
          userId: owner.id,
          accessHash: hashToken(token),
          refreshHash: hashToken(`r-${token}`),
          accessExpiresAt: new Date(Date.now() + 3_600_000),
          refreshExpiresAt: new Date(Date.now() + 7_200_000),
        },
      });
      tokens.scratch = token;
      expect((await post(m.id, "scratch")).status).toBe(404);
    } finally {
      await prisma.tenant.delete({ where: { id: t.id } });
    }
  });
});
