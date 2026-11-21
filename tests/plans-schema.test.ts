import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { tryConnect } from "./helpers-db";
import { isTenantModel, forTenant } from "../lib/tenant-scope";
import { ApiError } from "../lib/auth/errors";

describe("sprint 2 models are tenant-scoped", () => {
  const models = [
    "WorkoutPlan", "WorkoutPlanDay", "WorkoutPlanItem", "PlanAssignment", "WorkoutLog",
    "MemberUpdate", "CoachAvailability", "SessionBooking", "TenantSettings", "GoalCheckIn",
  ];
  for (const m of models) it(`${m} is tenant-owned`, () => expect(isTenantModel(m)).toBe(true));
});

describe("conflict error code", () => {
  it("maps to 409", () => {
    expect(new ApiError("conflict", "x").status).toBe(409);
  });
});

describe("plans, bookings and availability constraints (local Postgres)", () => {
  let prisma: PrismaClient | null = null;
  let tenantId = "";
  let otherId = "";
  let coachId = "";
  let memberId = "";
  let exerciseId = "";
  let dayId = "";
  let planId = "";
  let sessionId = "";

  beforeAll(async () => {
    prisma = await tryConnect();
    if (!prisma) return;
    const sfx = Date.now().toString(36);
    tenantId = (await prisma.tenant.create({ data: { slug: `pl-${sfx}`, name: "Plans test" } })).id;
    otherId = (await prisma.tenant.create({ data: { slug: `pl2-${sfx}`, name: "Plans test 2" } })).id;
    coachId = (await prisma.user.create({ data: { tenantId, role: "COACH", email: "c@pl.test", name: "Coach" } })).id;
    memberId = (await prisma.member.create({ data: { tenantId, displayName: "Test Member" } })).id;
    exerciseId = (
      await prisma.exercise.create({
        data: { tenantId, source: "ORIGINAL", sourceId: "x", sportSlug: "gym", name: "Squat", licence: "Original (project)" },
      })
    ).id;
    planId = (await prisma.workoutPlan.create({ data: { tenantId, coachId, title: "P", cadence: "WEEKLY" } })).id;
    dayId = (await prisma.workoutPlanDay.create({ data: { tenantId, planId, dayIndex: 1 } })).id;
    const v = await prisma.venue.create({ data: { tenantId, name: "V" } });
    const sp = await prisma.sport.create({ data: { tenantId, slug: "karate", name: "Karate" } });
    const b = await prisma.batch.create({
      data: { tenantId, venueId: v.id, sportId: sp.id, coachId, name: "B", daysOfWeek: [1], startTime: "17:00", endTime: "18:00" },
    });
    sessionId = (
      await prisma.session.create({
        data: { tenantId, batchId: b.id, coachId, startsAt: new Date("2026-11-10T11:30:00Z"), endsAt: new Date("2026-11-10T12:30:00Z") },
      })
    ).id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherId] } } });
    await prisma.$disconnect();
  });

  const item = (extra: Record<string, unknown>) => ({ tenantId, dayId, exerciseId, position: 1, ...extra });

  it("plan item needs reps or duration and respects ranges", async (ctx) => {
    if (!prisma) return ctx.skip();
    await expect(prisma.workoutPlanItem.create({ data: item({ sets: 3 }) as never })).rejects.toThrow();
    await expect(prisma.workoutPlanItem.create({ data: item({ reps: 201 }) as never })).rejects.toThrow();
    await expect(prisma.workoutPlanItem.create({ data: item({ reps: 10, sets: 21 }) as never })).rejects.toThrow();
    await expect(prisma.workoutPlanItem.create({ data: item({ reps: 10, restSeconds: 901 }) as never })).rejects.toThrow();
    await expect(prisma.workoutPlanItem.create({ data: item({ durationSeconds: 7201 }) as never })).rejects.toThrow();
    await expect(prisma.workoutPlanItem.create({ data: item({ durationSeconds: 60, sets: 2 }) as never })).resolves.toBeTruthy();
  });

  it("plan day index must be 1-31", async (ctx) => {
    if (!prisma) return ctx.skip();
    await expect(prisma.workoutPlanDay.create({ data: { tenantId, planId, dayIndex: 32 } })).rejects.toThrow();
    await expect(prisma.workoutPlanDay.create({ data: { tenantId, planId, dayIndex: 0 } })).rejects.toThrow();
  });

  it("availability weekday and time order are checked", async (ctx) => {
    if (!prisma) return ctx.skip();
    const base = { tenantId, coachId, weekday: 2, startTime: "09:00", endTime: "10:00" };
    await expect(prisma.coachAvailability.create({ data: { ...base, weekday: 8 } })).rejects.toThrow();
    await expect(prisma.coachAvailability.create({ data: { ...base, startTime: "10:00", endTime: "09:00" } })).rejects.toThrow();
    await expect(prisma.coachAvailability.create({ data: base })).resolves.toBeTruthy();
  });

  it("booking waitlist position only with WAITLISTED", async (ctx) => {
    if (!prisma) return ctx.skip();
    const base = { tenantId, sessionId, memberId, bookedById: coachId };
    await expect(prisma.sessionBooking.create({ data: { ...base, status: "BOOKED", waitlistPosition: 1 } })).rejects.toThrow();
    await expect(prisma.sessionBooking.create({ data: { ...base, status: "WAITLISTED" } })).rejects.toThrow();
    await expect(prisma.sessionBooking.create({ data: { ...base, status: "WAITLISTED", waitlistPosition: 1 } })).resolves.toBeTruthy();
    await expect(prisma.sessionBooking.create({ data: { ...base, status: "BOOKED" } })).rejects.toThrow(); // unique per member+session
  });

  it("assignment end date, and one live assignment per plan and member", async (ctx) => {
    if (!prisma) return ctx.skip();
    const base = { tenantId, planId, memberId, assignedById: coachId, planVersion: 1 };
    await expect(
      prisma.planAssignment.create({ data: { ...base, startsOn: new Date("2026-11-10"), endsOn: new Date("2026-11-09") } }),
    ).rejects.toThrow();
    const first = await prisma.planAssignment.create({ data: { ...base, startsOn: new Date("2026-11-10") } });
    await expect(prisma.planAssignment.create({ data: { ...base, startsOn: new Date("2026-11-11") } })).rejects.toThrow();
    await prisma.planAssignment.update({ where: { id: first.id }, data: { status: "ENDED" } });
    await expect(prisma.planAssignment.create({ data: { ...base, startsOn: new Date("2026-11-12") } })).resolves.toBeTruthy();
  });

  it("scoped client hides other tenants' plans and settings", async (ctx) => {
    if (!prisma) return ctx.skip();
    await prisma.tenantSettings.create({ data: { tenantId } });
    await prisma.tenantSettings.create({ data: { tenantId: otherId } });
    expect(await forTenant(prisma, tenantId).workoutPlan.count()).toBe(1);
    expect(await forTenant(prisma, otherId).workoutPlan.count()).toBe(0);
    expect(await forTenant(prisma, otherId).tenantSettings.count()).toBe(1);
    expect(await forTenant(prisma, otherId).planAssignment.findFirst({ where: { planId } })).toBeNull();
    const s = await forTenant(prisma, tenantId).tenantSettings.findFirst();
    expect(s?.bookingCancelWindowMinutes).toBe(120);
    expect(s?.showMissedSessionCost).toBe(false);
  });

  it("member leftOn defaults to null", async (ctx) => {
    if (!prisma) return ctx.skip();
    expect((await prisma.member.findUnique({ where: { id: memberId } }))?.leftOn).toBeNull();
  });
});
