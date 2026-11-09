import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { assertCanViewBatch, assertCanViewMember, batchWhere, memberWhere, sessionWhere } from "../lib/auth/access";
import type { Principal } from "../lib/auth/principal";
import { forTenant } from "../lib/tenant-scope";
import { tryConnect } from "./helpers-db";

describe("access fragments (no database)", () => {
  const base = { tenantId: "t" };
  it("owner is unrestricted", () => {
    const o: Principal = { ...base, userId: "o", role: "owner" };
    expect(memberWhere(o)).toEqual({});
    expect(batchWhere(o)).toEqual({});
    expect(sessionWhere(o)).toEqual({});
  });
  it("coach is limited to own batches", () => {
    const c: Principal = { ...base, userId: "c", role: "coach" };
    expect(batchWhere(c)).toEqual({ coachId: "c" });
    expect(sessionWhere(c)).toEqual({ coachId: "c" });
  });
});

describe("own-view scoping (local Postgres)", () => {
  let prisma: PrismaClient | null = null;
  const sfx = Date.now().toString(36);
  const ids = { a: "", b: "" };
  const u: Record<string, string> = {};
  const m: Record<string, string> = {};
  const batch: Record<string, string> = {};

  beforeAll(async () => {
    prisma = await tryConnect();
    if (!prisma) return;
    const db = prisma;
    const mk = async (slug: string) => (await db.tenant.create({ data: { slug: `${slug}-${sfx}`, name: slug } })).id;
    ids.a = await mk("acc-a");
    ids.b = await mk("acc-b");
    const user = async (key: string, tenantId: string, role: "OWNER" | "COACH" | "CUSTOMER") =>
      (u[key] = (await db.user.create({ data: { tenantId, role, email: `${key}@x.test`, name: key } })).id);
    await user("ownerA", ids.a, "OWNER");
    await user("coach1", ids.a, "COACH");
    await user("coach2", ids.a, "COACH");
    await user("parent", ids.a, "CUSTOMER");
    await user("adult", ids.a, "CUSTOMER");
    await user("coachB", ids.b, "COACH");
    const venue = await db.venue.create({ data: { tenantId: ids.a, name: "V" } });
    const sport = await db.sport.create({ data: { tenantId: ids.a, slug: "karate", name: "Karate" } });
    const venueB = await db.venue.create({ data: { tenantId: ids.b, name: "V" } });
    const sportB = await db.sport.create({ data: { tenantId: ids.b, slug: "karate", name: "Karate" } });
    const mkBatch = async (key: string, tenantId: string, coachId: string, venueId: string, sportId: string) =>
      (batch[key] = (
        await db.batch.create({
          data: { tenantId, coachId, venueId, sportId, name: key, daysOfWeek: [1], startTime: "18:00", endTime: "19:00" },
        })
      ).id);
    await mkBatch("b1", ids.a, u.coach1, venue.id, sport.id);
    await mkBatch("b2", ids.a, u.coach2, venue.id, sport.id);
    await mkBatch("bB", ids.b, u.coachB, venueB.id, sportB.id);
    const guardian = await db.guardian.create({ data: { tenantId: ids.a, userId: u.parent, name: "Parent" } });
    const mkMember = async (key: string, data: object, b: string) => {
      m[key] = (await db.member.create({ data: { tenantId: ids.a, displayName: key, ...data } })).id;
      await db.batchMember.create({ data: { tenantId: ids.a, batchId: b, memberId: m[key] } });
    };
    await mkMember("kid", { isMinor: true, guardianId: guardian.id }, batch.b1);
    await mkMember("adultSelf", { userId: u.adult }, batch.b1);
    await mkMember("other", {}, batch.b2);
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.tenant.deleteMany({ where: { id: { in: [ids.a, ids.b] } } });
    await prisma.$disconnect();
  });

  const P = (key: string, role: Principal["role"], tenantId: string): Principal => ({
    userId: u[key],
    tenantId,
    role,
  });

  it("owner sees the whole tenant, not another tenant", async (ctx) => {
    if (!prisma) return ctx.skip();
    const p = P("ownerA", "owner", ids.a);
    const db = forTenant(prisma, ids.a);
    expect(await db.member.count({ where: memberWhere(p) })).toBe(3);
    expect(await db.batch.count({ where: batchWhere(p) })).toBe(2);
    await expect(assertCanViewBatch(db, p, batch.bB)).rejects.toMatchObject({ code: "not_found" });
  });

  it("coach sees only own batches and their members", async (ctx) => {
    if (!prisma) return ctx.skip();
    const p = P("coach1", "coach", ids.a);
    const db = forTenant(prisma, ids.a);
    expect((await db.batch.findMany({ where: batchWhere(p) })).map((b) => b.name)).toEqual(["b1"]);
    expect(await db.member.count({ where: memberWhere(p) })).toBe(2);
    await expect(assertCanViewMember(db, p, m.kid)).resolves.toBeUndefined();
    await expect(assertCanViewMember(db, p, m.other)).rejects.toMatchObject({ code: "forbidden" });
    await expect(assertCanViewBatch(db, p, batch.b2)).rejects.toMatchObject({ code: "forbidden" });
    await expect(assertCanViewBatch(db, p, batch.bB)).rejects.toMatchObject({ code: "not_found" });
  });

  it("customer sees only self or linked child", async (ctx) => {
    if (!prisma) return ctx.skip();
    const db = forTenant(prisma, ids.a);
    const parent = P("parent", "customer", ids.a);
    expect((await db.member.findMany({ where: memberWhere(parent) })).map((x) => x.id)).toEqual([m.kid]);
    await expect(assertCanViewMember(db, parent, m.adultSelf)).rejects.toMatchObject({ code: "forbidden" });
    const adult = P("adult", "customer", ids.a);
    expect((await db.member.findMany({ where: memberWhere(adult) })).map((x) => x.id)).toEqual([m.adultSelf]);
    await expect(assertCanViewMember(db, adult, m.kid)).rejects.toMatchObject({ code: "forbidden" });
    expect((await db.batch.findMany({ where: batchWhere(parent) })).map((b) => b.name)).toEqual(["b1"]);
  });

  it("another tenant's member id is a 404 for everyone", async (ctx) => {
    if (!prisma) return ctx.skip();
    const dbB = forTenant(prisma, ids.b);
    await expect(assertCanViewMember(dbB, P("coachB", "coach", ids.b), m.kid)).rejects.toMatchObject({
      code: "not_found",
    });
  });
});
