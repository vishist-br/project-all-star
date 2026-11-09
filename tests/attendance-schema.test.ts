import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { tryConnect } from "./helpers-db";

describe("attendance constraints (local Postgres)", () => {
  let prisma: PrismaClient | null = null;
  let tenantId = "";
  let sessionId = "";
  let memberId = "";
  let userId = "";

  beforeAll(async () => {
    prisma = await tryConnect();
    if (!prisma) return;
    const t = await prisma.tenant.create({ data: { slug: `att-${Date.now().toString(36)}`, name: "Att test" } });
    tenantId = t.id;
    const u = await prisma.user.create({ data: { tenantId, role: "COACH", email: "c@att.test", name: "Coach" } });
    userId = u.id;
    const v = await prisma.venue.create({ data: { tenantId, name: "V" } });
    const sp = await prisma.sport.create({ data: { tenantId, slug: "karate", name: "Karate" } });
    const b = await prisma.batch.create({
      data: { tenantId, venueId: v.id, sportId: sp.id, coachId: u.id, name: "B", daysOfWeek: [1, 3], startTime: "17:00", endTime: "18:00" },
    });
    const s = await prisma.session.create({
      data: { tenantId, batchId: b.id, coachId: u.id, startsAt: new Date("2026-11-10T11:30:00Z"), endsAt: new Date("2026-11-10T12:30:00Z") },
    });
    sessionId = s.id;
    memberId = (await prisma.member.create({ data: { tenantId, displayName: "Test Kid", isMinor: true } })).id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.attendance.deleteMany({ where: { tenantId } });
    await prisma.session.deleteMany({ where: { tenantId } });
    await prisma.batch.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } }); // cascades the rest
    await prisma.$disconnect();
  });

  const base = () => ({ tenantId, sessionId, memberId, markedById: userId });

  it("accepts present with no photo and excused with a reason", async (ctx) => {
    if (!prisma) return ctx.skip();
    const row = await prisma.attendance.create({ data: { ...base(), status: "PRESENT", clientId: "c-1" } });
    expect(row.photoRef).toBeNull();
    await prisma.attendance.update({ where: { id: row.id }, data: { status: "EXCUSED", reason: "EXAM" } });
  });

  it("rejects excused without a reason and a reason on non-excused", async (ctx) => {
    if (!prisma) return ctx.skip();
    const m2 = await prisma.member.create({ data: { tenantId, displayName: "Kid Two" } });
    await expect(
      prisma.attendance.create({ data: { ...base(), memberId: m2.id, status: "EXCUSED", clientId: "c-2" } }),
    ).rejects.toThrow();
    await expect(
      prisma.attendance.create({ data: { ...base(), memberId: m2.id, status: "ABSENT", reason: "TRAVEL", clientId: "c-3" } }),
    ).rejects.toThrow();
  });

  it("makes a retried upload with the same clientId fail uniquely", async (ctx) => {
    if (!prisma) return ctx.skip();
    const m3 = await prisma.member.create({ data: { tenantId, displayName: "Kid Three" } });
    await expect(
      prisma.attendance.create({ data: { ...base(), memberId: m3.id, status: "PRESENT", clientId: "c-1" } }),
    ).rejects.toThrow();
  });
});
