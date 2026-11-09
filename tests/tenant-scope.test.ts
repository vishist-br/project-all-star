import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { forTenant, isTenantModel, scopeArgs, TenantScopeError } from "../lib/tenant-scope";
import { tryConnect } from "./helpers-db";

describe("scopeArgs (no database)", () => {
  it("ANDs tenantId into reads", () => {
    expect(scopeArgs("findMany", { where: { name: "x" } }, "A")).toEqual({
      where: { AND: [{ name: "x" }, { tenantId: "A" }] },
    });
  });
  it("injects tenantId on create and rejects a conflicting one", () => {
    expect(scopeArgs("create", { data: { name: "x" } }, "A")).toEqual({ data: { name: "x", tenantId: "A" } });
    expect(() => scopeArgs("create", { data: { tenantId: "B" } }, "A")).toThrow(TenantScopeError);
  });
  it("rejects moving a row to another tenant and unknown operations", () => {
    expect(() => scopeArgs("update", { where: { id: "1" }, data: { tenantId: "B" } }, "A")).toThrow(TenantScopeError);
    expect(() => scopeArgs("findRaw", {}, "A")).toThrow(TenantScopeError);
  });
  it("treats Tenant as global and User as tenant-owned", () => {
    expect(isTenantModel("Tenant")).toBe(false);
    expect(isTenantModel("User")).toBe(true);
  });
});

describe("tenant isolation (local Postgres)", () => {
  let prisma: PrismaClient | null = null;
  const suffix = Date.now().toString(36);
  let a = "";
  let b = "";
  let bUserId = "";

  beforeAll(async () => {
    prisma = await tryConnect();
    if (!prisma) return;
    a = (await prisma.tenant.create({ data: { slug: `test-a-${suffix}`, name: "Test A" } })).id;
    b = (await prisma.tenant.create({ data: { slug: `test-b-${suffix}`, name: "Test B" } })).id;
    bUserId = (await prisma.user.create({ data: { tenantId: b, role: "OWNER", email: "o@b.test", name: "Owner B" } })).id;
    await prisma.user.create({ data: { tenantId: a, role: "OWNER", email: "o@a.test", name: "Owner A" } });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.tenant.deleteMany({ where: { id: { in: [a, b] } } }); // cascades to tenant rows
    await prisma.$disconnect();
  });

  it("tenant A cannot read tenant B rows", async (ctx) => {
    if (!prisma) return ctx.skip();
    const scoped = forTenant(prisma, a);
    const list = await scoped.user.findMany();
    expect(list.map((u) => u.email)).toEqual(["o@a.test"]);
    expect(await scoped.user.findFirst({ where: { id: bUserId } })).toBeNull();
    expect(await scoped.user.findUnique({ where: { id: bUserId } })).toBeNull();
    expect(await scoped.user.count()).toBe(1);
  });

  it("tenant A cannot write or delete tenant B rows", async (ctx) => {
    if (!prisma) return ctx.skip();
    const scoped = forTenant(prisma, a);
    await expect(scoped.user.update({ where: { id: bUserId }, data: { name: "hacked" } })).rejects.toThrow();
    expect((await scoped.user.updateMany({ where: { id: bUserId }, data: { name: "hacked" } })).count).toBe(0);
    expect((await scoped.user.deleteMany({ where: { id: bUserId } })).count).toBe(0);
    await expect(
      scoped.user.create({ data: { tenantId: b, role: "COACH", email: "x@b.test", name: "x" } }),
    ).rejects.toThrow(TenantScopeError);
    const untouched = await prisma.user.findUniqueOrThrow({ where: { id: bUserId } });
    expect(untouched.name).toBe("Owner B");
  });

  it("creates through the scoped client land in the caller's tenant", async (ctx) => {
    if (!prisma) return ctx.skip();
    const scoped = forTenant(prisma, a);
    const row = await scoped.user.create({
      data: { role: "COACH", email: "c@a.test", name: "Coach A" } as never,
    });
    expect(row.tenantId).toBe(a);
  });
});
