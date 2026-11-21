import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { tryConnect } from "./helpers-db";
import { forTenant } from "../lib/tenant-scope";
import { recordMemberUpdates } from "../lib/api/member-updates";

describe("recordMemberUpdates (local Postgres)", () => {
  let prisma: PrismaClient | null = null;
  let tenantId = "";
  const memberIds: string[] = [];

  beforeAll(async () => {
    prisma = await tryConnect();
    if (!prisma) return;
    tenantId = (await prisma.tenant.create({ data: { slug: `mu-${Date.now().toString(36)}`, name: "Updates" } })).id;
    for (const n of ["A", "B"]) memberIds.push((await prisma.member.create({ data: { tenantId, displayName: `M ${n}` } })).id);
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.$disconnect();
  });

  it("writes one row per distinct member through the scoped client", async (ctx) => {
    if (!prisma) return ctx.skip();
    const scoped = forTenant(prisma, tenantId);
    const n = await recordMemberUpdates(scoped, {
      memberIds: [...memberIds, memberIds[0]],
      kind: "PLAN_ASSIGNED",
      entityType: "plan",
      entityId: "p1",
      params: { planTitle: "Home circuit" },
    });
    expect(n).toBe(2);
    const rows = await scoped.memberUpdate.findMany();
    expect(rows).toHaveLength(2);
    expect(rows[0].tenantId).toBe(tenantId);
    expect(rows[0].readAt).toBeNull();
    expect(await recordMemberUpdates(scoped, { memberIds: [], kind: "GOAL_SET", entityType: "goal", entityId: "g" })).toBe(0);
  });
});
