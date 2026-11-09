import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { tryConnect } from "./helpers-db";

describe("levels, goals and achievements (local Postgres)", () => {
  let prisma: PrismaClient | null = null;
  let tenantId = "";
  let memberId = "";
  let sportId = "";

  beforeAll(async () => {
    prisma = await tryConnect();
    if (!prisma) return;
    tenantId = (await prisma.tenant.create({ data: { slug: `prog-${Date.now().toString(36)}`, name: "Prog test" } })).id;
    sportId = (await prisma.sport.create({ data: { tenantId, slug: "karate", name: "Karate" } })).id;
    memberId = (await prisma.member.create({ data: { tenantId, displayName: "Test Kid", isMinor: true } })).id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.tenant.delete({ where: { id: tenantId } }); // cascades
    await prisma.$disconnect();
  });

  it("builds a level history timeline", async (ctx) => {
    if (!prisma) return ctx.skip();
    const white = await prisma.level.create({ data: { tenantId, sportId, name: "White", rank: 1 } });
    const yellow = await prisma.level.create({ data: { tenantId, sportId, name: "Yellow", rank: 2 } });
    await prisma.memberLevel.create({ data: { tenantId, memberId, levelId: white.id, achievedOn: new Date("2026-01-05") } });
    await prisma.memberLevel.create({ data: { tenantId, memberId, levelId: yellow.id, achievedOn: new Date("2026-06-05") } });
    const timeline = await prisma.memberLevel.findMany({
      where: { tenantId, memberId },
      orderBy: { achievedOn: "asc" },
      include: { level: true },
    });
    expect(timeline.map((t) => t.level.name)).toEqual(["White", "Yellow"]);
  });

  it("stores hourly and daily-streak achievements side by side", async (ctx) => {
    if (!prisma) return ctx.skip();
    await prisma.achievement.create({
      data: { tenantId, memberId, code: "time_on_mat", title: "10 hours trained", measureUnit: "HOURS", measureValue: "10.5" },
    });
    await prisma.achievement.create({
      data: { tenantId, memberId, code: "streak", title: "7 day streak", measureUnit: "STREAK_DAYS", measureValue: 7 },
    });
    const rows = await prisma.achievement.findMany({ where: { tenantId, memberId }, orderBy: { measureUnit: "asc" } });
    expect(rows.map((r) => [r.measureUnit, Number(r.measureValue)])).toEqual([
      ["HOURS", 10.5],
      ["STREAK_DAYS", 7],
    ]);
  });
});
