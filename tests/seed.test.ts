import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { tryConnect } from "./helpers-db";
import { seedDemo } from "../prisma/seed/demo";
import { TENANTS } from "../prisma/seed/data";
import { RICH } from "../prisma/seed/rich-data";
import { addDays, isoDow, seedToday } from "../prisma/seed/dates";

describe("demo seed", () => {
  it("defines three tenants with distinct branding and synthetic names", () => {
    expect(TENANTS).toHaveLength(3);
    expect(new Set(TENANTS.map((t) => t.theme.primaryColor)).size).toBe(3);
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
    }, 60_000);
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
      // Seeds the demo tenants twice: the vitest default of 5 s is too tight on a loaded machine.
    }, 120_000);

    it("rich layer: every tenant has data for every owner, coach and customer screen, idempotently", async (ctx) => {
      if (!prisma) return ctx.skip();
      const db = prisma;
      const today = "2026-11-21"; // pinned so assertions are exact; dates are relative to it
      try {
        const ids = await seedDemo(db, { rich: true, today });
        const snapshot = async (tenantId: string) => ({
          sessions: await db.session.count({ where: { tenantId } }),
          attendance: await db.attendance.count({ where: { tenantId } }),
          logs: await db.workoutLog.count({ where: { tenantId } }),
          goals: await db.goal.count({ where: { tenantId } }),
          bookings: await db.sessionBooking.count({ where: { tenantId } }),
          updates: await db.memberUpdate.count({ where: { tenantId } }),
          exercises: await db.exercise.count({ where: { tenantId } }),
          members: await db.member.count({ where: { tenantId } }),
        });
        const first = await Promise.all(ids.map(snapshot));
        await seedDemo(db, { rich: true, today });
        expect(await Promise.all(ids.map(snapshot))).toEqual(first);

        const now = new Date(`${today}T00:00:00+05:30`);
        const DAY = 86_400_000;
        for (const [i, tenantId] of ids.entries()) {
          const r = RICH[i];
          const where = { tenantId };
          // catalog is imported for the tenant and plans use it
          expect(await db.exercise.count({ where })).toBeGreaterThan(800);
          const plans = await db.workoutPlan.findMany({ where, include: { days: { include: { items: true } } } });
          expect(new Set(plans.map((p) => p.cadence))).toEqual(new Set(["DAILY", "WEEKLY", "MONTHLY"]));
          expect(new Set(plans.map((p) => p.coachId)).size).toBeGreaterThanOrEqual(2);
          for (const p of plans) for (const d of p.days) expect(d.items.length).toBeGreaterThanOrEqual(2);
          // assignments: >= 70% of active members, one paused, one ended
          const active = await db.member.count({ where: { ...where, isActive: true } });
          const assigned = await db.planAssignment.findMany({ where: { ...where, member: { isActive: true } }, select: { memberId: true } });
          expect(new Set(assigned.map((a) => a.memberId)).size / active).toBeGreaterThanOrEqual(0.7);
          expect(await db.planAssignment.count({ where: { ...where, status: "PAUSED" } })).toBeGreaterThanOrEqual(1);
          expect(await db.planAssignment.count({ where: { ...where, status: "ENDED" } })).toBeGreaterThanOrEqual(1);
          // logs: mix of statuses, some started today
          const logStatus = new Set((await db.workoutLog.findMany({ where, select: { status: true }, distinct: ["status"] })).map((l) => l.status));
          expect(logStatus).toEqual(new Set(["COMPLETED", "SKIPPED", "STARTED"]));
          // goals: every member, every metric, check-ins on custom goals, achieved ones
          expect(await db.member.count({ where: { ...where, goals: { none: {} } } })).toBe(0);
          const metrics = new Set((await db.goal.findMany({ where, select: { metric: true }, distinct: ["metric"] })).map((g) => g.metric));
          expect(metrics).toEqual(new Set(["SESSIONS_ATTENDED", "WORKOUTS_COMPLETED", "LEVEL", "CUSTOM"]));
          expect(await db.goal.count({ where: { ...where, status: "ACHIEVED" } })).toBeGreaterThanOrEqual(1);
          const custom = await db.goal.findMany({ where: { ...where, metric: "CUSTOM" }, include: { _count: { select: { checkIns: true } } } });
          expect(custom.some((g) => g._count.checkIns >= 3 && g._count.checkIns <= 5)).toBe(true);
          // sessions: 12 weeks back, 2 weeks ahead, unlogged, cancelled, attendance mix
          const earliest = await db.session.findFirstOrThrow({ where, orderBy: { startsAt: "asc" }, select: { startsAt: true } });
          const latest = await db.session.findFirstOrThrow({ where, orderBy: { startsAt: "desc" }, select: { startsAt: true } });
          expect(earliest.startsAt.getTime()).toBeLessThan(now.getTime() - 80 * DAY);
          expect(latest.startsAt.getTime()).toBeGreaterThan(now.getTime() + 10 * DAY);
          expect(await db.session.count({ where: { ...where, status: "SCHEDULED", startsAt: { lt: now } } })).toBeGreaterThanOrEqual(2);
          expect(await db.session.count({ where: { ...where, status: "CANCELLED" } })).toBeGreaterThanOrEqual(2);
          const att = await db.attendance.groupBy({ by: ["status"], where, _count: true });
          const total = att.reduce((n, a) => n + a._count, 0);
          const share = (s: string) => (att.find((a) => a.status === s)?._count ?? 0) / total;
          expect(share("PRESENT")).toBeGreaterThan(0.65);
          expect(share("PRESENT")).toBeLessThan(0.92);
          expect(share("ABSENT")).toBeGreaterThan(0.04);
          expect(share("EXCUSED")).toBeGreaterThan(0.03);
          // retention: joiners and leavers
          const left = await db.member.findMany({ where: { ...where, leftOn: { not: null } } });
          expect(left.length).toBeGreaterThanOrEqual(2);
          expect(left.every((m) => !m.isActive && m.leftOn!.getTime() >= now.getTime() - 90 * DAY)).toBe(true);
          expect(await db.member.count({ where: { ...where, joinedOn: { gte: new Date(now.getTime() - 30 * DAY) } } })).toBeGreaterThanOrEqual(2);
          const feeStatuses = new Set((await db.member.findMany({ where, select: { feeStatus: true }, distinct: ["feeStatus"] })).map((m) => m.feeStatus));
          expect(feeStatuses.size).toBeGreaterThanOrEqual(3);
          // bookings: one full session with two waitlisted; availability; settings; feed
          const waitlisted = await db.sessionBooking.findMany({ where: { ...where, status: "WAITLISTED" }, include: { session: true } });
          expect(waitlisted).toHaveLength(2);
          const fullSession = waitlisted[0].session;
          expect(await db.sessionBooking.count({ where: { ...where, sessionId: fullSession.id, status: "BOOKED" } })).toBe(fullSession.capacity);
          for (const c of await db.user.findMany({ where: { ...where, role: "COACH" } })) {
            const n = await db.coachAvailability.count({ where: { ...where, coachId: c.id } });
            expect(n).toBeGreaterThanOrEqual(3);
            expect(n).toBeLessThanOrEqual(5);
          }
          expect(await db.tenantSettings.count({ where })).toBe(1);
          expect(await db.memberUpdate.count({ where: { ...where, readAt: null } })).toBeGreaterThan(0);
          expect(await db.memberUpdate.count({ where: { ...where, readAt: { not: null } } })).toBeGreaterThan(0);
          // demo customers see data on each customer screen
          for (const key of r.demoCustomers) {
            const m = await db.member.findFirstOrThrow({ where: { ...where, id: { endsWith: `member-${key}` } } });
            expect(await db.planAssignment.count({ where: { ...where, memberId: m.id, status: "ACTIVE" } })).toBeGreaterThanOrEqual(1);
            expect(await db.workoutLog.count({ where: { ...where, memberId: m.id, status: "STARTED" } })).toBeGreaterThanOrEqual(1);
            expect(await db.attendance.count({ where: { ...where, memberId: m.id } })).toBeGreaterThan(10);
            expect(await db.sessionBooking.count({ where: { ...where, memberId: m.id } })).toBeGreaterThanOrEqual(1);
            expect(await db.memberUpdate.count({ where: { ...where, memberId: m.id, readAt: null } })).toBeGreaterThanOrEqual(1);
            expect(await db.goal.count({ where: { ...where, memberId: m.id } })).toBeGreaterThanOrEqual(3);
          }
        }

        // names the UI and e2e rely on still exist
        expect(await db.member.count({ where: { tenantId: ids[0], displayName: { in: ["Sample Kid 01", "Sample Adult 01"] } } })).toBe(2);
        expect(await db.user.count({ where: { tenantId: ids[0], name: "Sample Coach Alpha" } })).toBe(1);
        expect(await db.member.count({ where: { tenantId: ids[1], displayName: { startsWith: "Sample Member " } } })).toBeGreaterThanOrEqual(8);

        // all data is fake
        const emails = await db.user.findMany({ where: { tenantId: { in: ids } }, select: { email: true } });
        for (const u of emails) expect(u.email).toMatch(/\.example\.test$/);
        const names = await db.member.findMany({ where: { tenantId: { in: ids } }, select: { displayName: true } });
        for (const n of names) expect(n.displayName).toMatch(/^Sample /);

        // dates follow the anchor: a later anchor shifts the whole window
        await seedDemo(db, { rich: true, today: addDays(today, 30) });
        const shifted = await db.session.findFirstOrThrow({ where: { tenantId: ids[0] }, orderBy: { startsAt: "desc" } });
        expect(shifted.startsAt.getTime()).toBeGreaterThan(new Date(`${addDays(today, 40)}T00:00:00+05:30`).getTime());
      } finally {
        // later test files assert exact base-seed counts: put the database back to the base seed
        await seedDemo(db);
      }
      expect(await db.workoutPlan.count({ where: { tenant: { slug: { in: TENANTS.map((t) => t.slug) } } } })).toBe(0);
    }, 120_000);

    it("anchor date helpers", () => {
      expect(seedToday({ SEED_TODAY: "2026-12-01" })).toBe("2026-12-01");
      expect(seedToday({})).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(isoDow("2026-11-23")).toBe(1);
      expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    });
  });
});
