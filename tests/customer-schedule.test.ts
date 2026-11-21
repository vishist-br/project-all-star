import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  cancelOpen,
  cancelWindowFrom,
  cancellableUntil,
  failureReason,
  monthGrid,
  monthRange,
  sessionAction,
  shiftMonth,
  spotsLeft,
  type SessionLike,
} from "../lib/customer/schedule";
import { feeBadge, goalValueText, hasData, orderGoals, percentText, weeklyAttendanceSeries, weeklyWorkoutSeries } from "../lib/customer/progress";
import { messages } from "../lib/i18n";
import { seedDemo } from "../prisma/seed/demo";
import { demoUserFor } from "../lib/viewer";
import { tryConnect } from "./helpers-db";

const now = new Date("2026-11-22T06:00:00Z");
const base: SessionLike = {
  id: "s1",
  startsAt: "2026-11-24T04:00:00Z",
  status: "scheduled",
  kind: "group_class",
  capacity: 4,
  bookedCount: 2,
  waitlistCount: 0,
  myBookingStatus: null,
};

describe("booking view-model (STAR-70)", () => {
  it("counts places left and never goes negative", () => {
    expect(spotsLeft(base)).toBe(2);
    expect(spotsLeft({ capacity: 4, bookedCount: 6 })).toBe(0);
    expect(spotsLeft({ capacity: null, bookedCount: 9 })).toBeNull();
  });

  it("offers book, waiting list, nothing or cancel-only depending on the session", () => {
    expect(sessionAction(base, now, true)).toBe("book");
    expect(sessionAction({ ...base, bookedCount: 4 }, now, true)).toBe("waitlist");
    expect(sessionAction({ ...base, bookedCount: 4 }, now, false)).toBe("full");
    expect(sessionAction({ ...base, capacity: null, bookedCount: 50 }, now, true)).toBe("book");
    expect(sessionAction({ ...base, myBookingStatus: "booked" }, now, true)).toBe("manage");
    expect(sessionAction({ ...base, myBookingStatus: "waitlisted", bookedCount: 4 }, now, true)).toBe("manage");
    // a cancelled booking can be booked again
    expect(sessionAction({ ...base, myBookingStatus: "cancelled" }, now, true)).toBe("book");
    expect(sessionAction({ ...base, status: "cancelled" }, now, true)).toBe("none");
    expect(sessionAction({ ...base, status: "completed" }, now, true)).toBe("none");
    expect(sessionAction({ ...base, kind: "one_on_one" }, now, true)).toBe("none");
    expect(sessionAction({ ...base, startsAt: "2026-11-22T05:00:00Z" }, now, true)).toBe("none");
  });

  it("computes the cancellation deadline and whether it is still open", () => {
    const until = cancellableUntil("2026-11-24T04:00:00Z", 120);
    expect(until).toBe("2026-11-24T02:00:00.000Z");
    expect(cancelOpen(until, new Date("2026-11-24T01:59:00Z"))).toBe(true);
    expect(cancelOpen(until, new Date("2026-11-24T02:01:00Z"))).toBe(false);
    expect(cancelOpen(null, now)).toBe(true);
  });

  it("reads the 409 cancelWindow detail and maps API errors to friendly reasons", () => {
    const details = [{ field: "cancelWindow", message: "2026-11-24T02:00:00.000Z" }];
    expect(cancelWindowFrom(details)).toBe("2026-11-24T02:00:00.000Z");
    expect(cancelWindowFrom([{ field: "cancelWindow", message: "nope" }])).toBeNull();
    expect(cancelWindowFrom(undefined)).toBeNull();
    expect(failureReason("conflict", "Bookings can only be cancelled until 120 minutes before the session", details)).toBe("closedWindow");
    expect(failureReason("conflict", "This session is full")).toBe("full");
    expect(failureReason("conflict", "This session has already started")).toBe("started");
    expect(failureReason("conflict", "This member already holds a booking for this session")).toBe("already");
    expect(failureReason("forbidden", "This member is not enrolled in this class")).toBe("notEnrolled");
    expect(failureReason("internal_error", "boom")).toBe("other");
  });

  it("builds Monday-first month grids", () => {
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    const grid = monthGrid("2026-11"); // 1 Nov 2026 is a Sunday
    expect(grid[0]).toEqual([null, null, null, null, null, null, "2026-11-01"]);
    expect(grid.every((r) => r.length === 7)).toBe(true);
    expect(grid.flat().filter(Boolean)).toHaveLength(30);
  });
});

describe("progress view-model (STAR-70)", () => {
  it("never turns missing data into 0", () => {
    expect(percentText(null)).toBeNull();
    expect(percentText(0)).toBe("0%");
    expect(percentText(87.5)).toBe("87.5%");
    expect(percentText(100)).toBe("100%");
  });

  it("leaves gaps for weeks with nothing to measure", () => {
    const weeks = [
      { weekStart: "2026-11-02", attended: 2, missed: 1, workoutsCompleted: 3, workoutsScheduled: 4 },
      { weekStart: "2026-11-09", attended: 0, missed: 0, workoutsCompleted: 0, workoutsScheduled: 0 },
      { weekStart: "2026-11-16", attended: 0, missed: 2, workoutsCompleted: 0, workoutsScheduled: 3 },
    ];
    expect(weeklyAttendanceSeries(weeks)).toEqual([66.7, null, 0]);
    expect(weeklyWorkoutSeries(weeks)).toEqual({ completed: [3, null, 0], scheduled: [4, null, 3] });
    expect(hasData([null, null])).toBe(false);
    expect(hasData([null, 0])).toBe(true);
  });

  it("shows goal values straight from the API", () => {
    const g = { status: "active", metric: "custom", progressPercent: 40, currentValue: 12, targetValue: 20, unit: "reps" };
    expect(goalValueText(g, "units")).toBe("12 / 20 reps");
    expect(goalValueText({ ...g, unit: null }, "units")).toBe("12 / 20 units");
    expect(goalValueText({ ...g, currentValue: null }, "units")).toBeNull();
    expect(goalValueText({ ...g, targetValue: null }, "units")).toBe("12 reps");
  });

  it("orders active goals first and keeps API order inside a group", () => {
    const list = [
      { id: "a", status: "achieved" },
      { id: "b", status: "active" },
      { id: "c", status: "dropped" },
      { id: "d", status: "active" },
    ];
    expect(orderGoals(list).map((g) => g.id)).toEqual(["b", "d", "a", "c"]);
  });

  it("fee badge covers paid, due, overdue and unset", () => {
    expect(feeBadge("paid")).toEqual({ tone: "ok", key: "paid" });
    expect(feeBadge("due").tone).toBe("warn");
    expect(feeBadge("overdue").tone).toBe("danger");
    expect(feeBadge(undefined).key).toBe("none");
  });

  it("uses visibility wording, never accountability or payment-processing wording", () => {
    for (const l of ["en", "hi", "kn"] as const) {
      for (const [k, v] of Object.entries(messages[l])) {
        if (!/^(cs|cp|pf)\./.test(k)) continue;
        expect(v, `${l}:${k}`).not.toMatch(/accountab|surveil|payment processing/i);
      }
    }
  });
});

describe("demo viewer picks a customer with data", () => {
  let prisma: PrismaClient | null = null;
  beforeAll(async () => {
    prisma = await tryConnect();
    if (prisma) await seedDemo(prisma, { rich: true });
  });
  afterAll(async () => {
    if (prisma) await seedDemo(prisma);
    await prisma?.$disconnect();
  });

  it("returns a user linked to an active member with an active plan in every demo tenant", async (ctx) => {
    if (!prisma) return ctx.skip();
    const tenants = await prisma.tenant.findMany({ where: { slug: { in: ["demo-karate", "demo-gym", "demo-studio"] } } });
    expect(tenants).toHaveLength(3);
    for (const t of tenants) {
      const user = await demoUserFor(t.id, "customer");
      expect(user, t.slug).not.toBeNull();
      const member = await prisma.member.findFirst({
        where: {
          tenantId: t.id,
          isActive: true,
          OR: [{ userId: user!.id }, { guardian: { userId: user!.id } }],
          assignments: { some: { status: "ACTIVE" } },
        },
      });
      expect(member, t.slug).not.toBeNull();
    }
  });

  it("still returns the oldest owner and coach for those roles", async (ctx) => {
    if (!prisma) return ctx.skip();
    const t = await prisma.tenant.findUniqueOrThrow({ where: { slug: "demo-gym" } });
    const owner = await demoUserFor(t.id, "owner");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: owner!.id } })).role).toBe("OWNER");
    const coach = await demoUserFor(t.id, "coach");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: coach!.id } })).role).toBe("COACH");
  });
});
