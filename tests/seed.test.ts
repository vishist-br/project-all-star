import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { tryConnect } from "./helpers-db";
import { seedDemo } from "../prisma/seed/demo";
import { TENANTS } from "../prisma/seed/data";

describe("demo seed", () => {
  it("defines three tenants with distinct branding and synthetic names", () => {
    expect(TENANTS).toHaveLength(3);
    expect(new Set(TENANTS.map((t) => t.theme.primaryHex)).size).toBe(3);
    expect(new Set(TENANTS.map((t) => t.theme.logoUrl)).size).toBe(3);
    for (const t of TENANTS) {
      expect(t.name).toMatch(/^Sample /);
      for (const m of t.members) expect(m.name).toMatch(/^Sample /);
    }
  });

  describe("against local Postgres", () => {
    let prisma: PrismaClient | null = null;
    beforeAll(async () => {
      prisma = await tryConnect();
    });
    afterAll(async () => {
      await prisma?.$disconnect();
    });

    it("is idempotent and fills every tenant", async (ctx) => {
      if (!prisma) return ctx.skip();
      const ids = await seedDemo(prisma);
      const count = async () => ({
        tenants: await prisma!.tenant.count({ where: { id: { in: ids } } }),
        users: await prisma!.user.count({ where: { tenantId: { in: ids } } }),
        members: await prisma!.member.count({ where: { tenantId: { in: ids } } }),
        sessions: await prisma!.session.count({ where: { tenantId: { in: ids } } }),
        attendance: await prisma!.attendance.count({ where: { tenantId: { in: ids } } }),
      });
      const first = await count();
      await seedDemo(prisma);
      expect(await count()).toEqual(first);
      expect(first.tenants).toBe(3);

      for (const id of ids) {
        const where = { tenantId: id };
        expect(await prisma.tenantTheme.count({ where })).toBe(1);
        expect(await prisma.user.count({ where: { ...where, role: "OWNER" } })).toBe(1);
        expect(await prisma.user.count({ where: { ...where, role: "COACH" } })).toBeGreaterThanOrEqual(1);
        expect(await prisma.batch.count({ where })).toBeGreaterThanOrEqual(2);
        expect(await prisma.member.count({ where })).toBeGreaterThanOrEqual(6);
        expect(await prisma.session.count({ where: { ...where, status: "COMPLETED" } })).toBeGreaterThanOrEqual(3);
      }
    });
  });
});
