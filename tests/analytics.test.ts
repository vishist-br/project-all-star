import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { hashToken } from "../lib/auth/tokens";
import { tryConnect } from "./helpers-db";
import { validateSchemaName } from "./contract-schema";
import { forTenant } from "../lib/tenant-scope";
import {
  absenceRun,
  buildCards,
  isActiveOn,
  joinCohorts,
  kpi,
  loadPercent,
  previousPeriod,
  retentionPercent,
  slotHours,
  tallySessions,
  workoutsPending,
  type CardInput,
  type SessionFact,
} from "../lib/analytics/formulas";
import { getFeeStats, getOwnerInsights, getOwnerOverview, getOwnerTrends, getCoachWorkload } from "../lib/api/analytics";
import { getCoachStats, listCoaches } from "../lib/api/coaches";
import { GET as overviewRoute } from "../app/api/v1/analytics/overview/route";
import { GET as trendsRoute } from "../app/api/v1/analytics/trends/route";
import { GET as workloadRoute } from "../app/api/v1/analytics/coaches/route";
import { GET as feesRoute } from "../app/api/v1/analytics/fees/route";
import { GET as insightsRoute } from "../app/api/v1/analytics/insights/route";
import { GET as coachesRoute } from "../app/api/v1/coaches/route";
import { GET as coachStatsRoute } from "../app/api/v1/coaches/[coachId]/stats/route";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------------------------
// Pure formulas, hand-computed
// ---------------------------------------------------------------------------------------------

describe("analytics formulas (pure)", () => {
  const life = (joinedOn: string, leftOn: string | null = null, isActive = true) => ({ joinedOn, leftOn, isActive });

  it("isActiveOn: joined/left dates decide the past; isActive only matters from today", () => {
    const m = life("2026-06-01", "2026-10-12", false);
    expect(isActiveOn(m, "2026-05-31", "2026-10-31")).toBe(false); // before joining
    expect(isActiveOn(m, "2026-10-11", "2026-10-31")).toBe(true); // isActive=false is ignored in the past
    expect(isActiveOn(m, "2026-10-12", "2026-10-31")).toBe(false); // the day they leave they are gone
    expect(isActiveOn(life("2026-06-01", null, false), "2026-10-31", "2026-10-31")).toBe(false); // deactivated today
    expect(isActiveOn(life("2026-06-01", null, false), "2026-10-30", "2026-10-31")).toBe(true);
  });

  it("kpi: change percent is pct(value - previous, previous), null without a positive previous", () => {
    expect(kpi(6, 3)).toEqual({ value: 6, previous: 3, changePercent: 100 });
    expect(kpi(2, 4)).toEqual({ value: 2, previous: 4, changePercent: -50 });
    expect(kpi(5, 0)).toEqual({ value: 5, previous: 0, changePercent: null });
    expect(kpi(null, 40)).toEqual({ value: null, previous: 40, changePercent: null });
    expect(kpi(40, null)).toEqual({ value: 40, previous: null, changePercent: null });
    expect(kpi(0, 0).changePercent).toBeNull();
    expect(kpi(4)).toEqual({ value: 4, previous: null, changePercent: null });
  });

  it("previousPeriod is the same length immediately before", () => {
    expect(previousPeriod("2026-10-05", "2026-10-18")).toEqual({ from: "2026-09-21", to: "2026-10-04" });
    expect(previousPeriod("2026-10-05", "2026-10-05")).toEqual({ from: "2026-10-04", to: "2026-10-04" });
  });

  it("retention: members active the day before the period who are still active at its end", () => {
    const ms = [life("2026-06-01"), life("2026-06-02"), life("2026-09-10"), life("2026-05-01", "2026-10-12", false), life("2026-10-08", "2026-10-14", false)];
    // base: 4 active on 10-04 (the 10-08 joiner does not count); 3 kept at 10-18
    expect(retentionPercent(ms, "2026-10-05", "2026-10-18", "2026-10-31")).toBe(75);
    expect(retentionPercent([], "2026-10-05", "2026-10-18", "2026-10-31")).toBeNull();
    expect(retentionPercent([life("2026-10-06")], "2026-10-05", "2026-10-18", "2026-10-31")).toBeNull(); // nobody to retain
  });

  it("joinCohorts: 6 months, retained N days only for members old enough, null when nobody is", () => {
    const ms = [
      life("2026-05-01", "2026-10-12"),
      life("2026-06-01"),
      life("2026-06-02"),
      life("2026-08-01", "2026-09-25"),
      life("2026-09-10"),
      life("2026-10-07"),
      life("2026-10-08", "2026-10-14"),
    ];
    const c = joinCohorts(ms, "2026-10-31");
    expect(c.map((x) => x.month)).toEqual(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(c.map((x) => x.joined)).toEqual([1, 2, 0, 1, 1, 2]);
    expect(c[0]).toMatchObject({ retained30: 100, retained60: 100, retained90: 100 });
    expect(c[2]).toMatchObject({ retained30: null, retained60: null, retained90: null }); // nobody joined
    expect(c[3]).toMatchObject({ retained30: 100, retained60: 0, retained90: 0 }); // left 09-25, day 60 is 09-30
    expect(c[4]).toMatchObject({ retained30: 100, retained60: null, retained90: null }); // too recent for 60/90
    expect(c[5]).toMatchObject({ joined: 2, retained30: null, retained60: null, retained90: null });
    // January wraps back into the previous year
    expect(joinCohorts([], "2026-02-10", 3).map((x) => x.month)).toEqual(["2025-12", "2026-01", "2026-02"]);
  });

  it("tallySessions: holidays, excused absences, cancelled and future sessions never count as missed", () => {
    const now = new Date("2026-10-31T06:30:00Z"); // 12:00 IST
    const mk = (id: string, date: string, status: SessionFact["status"], end = "11:00"): SessionFact => ({
      id,
      date,
      startsAt: new Date(`${date}T10:00:00+05:30`),
      endsAt: new Date(`${date}T${end}:00+05:30`),
      status,
      coachId: "c",
      batchId: "b",
    });
    const att = new Map([
      ["done", { present: 3, absent: 1, excused: 2 }],
      ["hol", { present: 0, absent: 9, excused: 0 }],
    ]);
    const t = tallySessions(
      [mk("done", "2026-10-05", "COMPLETED"), mk("hol", "2026-10-09", "COMPLETED"), mk("x", "2026-10-12", "CANCELLED"), mk("late", "2026-10-14", "SCHEDULED"), mk("soon", "2026-10-31", "SCHEDULED", "11:30"), mk("future", "2026-11-03", "SCHEDULED")],
      att,
      new Set(["2026-10-09"]),
      now,
    );
    expect(t).toEqual({ scheduled: 3, completed: 1, cancelled: 1, unlogged: 1, present: 3, absent: 1, excused: 2 });
  });

  it("absenceRun counts leading absences; an excused absence or a present mark breaks it", () => {
    expect(absenceRun(["ABSENT", "ABSENT", "ABSENT", "PRESENT"])).toBe(3);
    expect(absenceRun(["ABSENT", "EXCUSED", "ABSENT", "ABSENT"])).toBe(1);
    expect(absenceRun(["PRESENT", "ABSENT"])).toBe(0);
    expect(absenceRun([])).toBe(0);
  });

  it("workoutsPending: adherence below 30% with at least 5 scheduled items", () => {
    expect(workoutsPending(10, 2)).toBe(20);
    expect(workoutsPending(10, 3)).toBeNull(); // exactly 30% is fine
    expect(workoutsPending(4, 0)).toBeNull(); // too few items
    expect(workoutsPending(5, 0)).toBe(0);
  });

  it("availability hours and load (capped at 100, null without availability)", () => {
    expect(slotHours("06:00", "09:00")).toBe(3);
    expect(slotHours("16:00", "17:30")).toBe(1.5);
    expect(loadPercent(1, 4.5)).toBe(22.2);
    expect(loadPercent(9, 4.5)).toBe(100);
    expect(loadPercent(2, 0)).toBeNull();
  });

  const base: CardInput = {
    attendancePercent: 70,
    previousAttendancePercent: 70,
    byWeekday: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, percent: null, sessions: 0 })),
    newMembers: 0,
    coaches: [],
    adherencePercent: null,
    membersWithPlan: 0,
    followUpCount: 0,
  };

  it("cards: nothing to say gives no cards", () => {
    expect(buildCards(base)).toEqual([]);
    expect(buildCards({ ...base, attendancePercent: null, previousAttendancePercent: null })).toEqual([]);
  });

  it("cards: best and low weekday need 3 sessions and a 15 point gap; ties go to the earlier weekday", () => {
    const wd = (rows: [number, number | null, number][]) => rows.map(([weekday, percent, sessions]) => ({ weekday, percent, sessions }));
    const cards = buildCards({ ...base, byWeekday: wd([[1, 90, 4], [2, 90, 5], [3, 50, 3], [4, 20, 2], [5, 60, 3]]) });
    expect(cards[0]).toMatchObject({ code: "best_weekday", tone: "positive", params: { weekday: "1", percent: "90" } });
    // weekday 4 has only 2 sessions so it is ignored; weekday 3 (50) is 20 below the 70 average
    expect(cards[1]).toMatchObject({ code: "low_weekday", tone: "attention", params: { weekday: "3", percent: "50" } });
    // gap of 14.9 is not enough
    const close = buildCards({ ...base, attendancePercent: 65, previousAttendancePercent: 65, byWeekday: wd([[2, 80, 3], [3, 50.1, 3]]) });
    expect(close.map((c) => c.code)).toEqual(["best_weekday"]);
  });

  it("cards: attendance trend in points, either direction, only from 5 points", () => {
    expect(buildCards({ ...base, attendancePercent: 75, previousAttendancePercent: 70 })[0]).toMatchObject({
      code: "attendance_trend",
      tone: "positive",
      params: { direction: "up", points: "5", percent: "75" },
    });
    expect(buildCards({ ...base, attendancePercent: 60, previousAttendancePercent: 70.5 })[0]).toMatchObject({
      code: "attendance_trend",
      tone: "attention",
      params: { direction: "down", points: "10.5" },
    });
    expect(buildCards({ ...base, attendancePercent: 74.9, previousAttendancePercent: 70 })).toEqual([]);
  });

  it("cards: new members, steady coaches (100% and 4+ sessions), plan adherence tone and follow-ups, max 6 in rule order", () => {
    const some = buildCards({
      ...base,
      newMembers: 2,
      coaches: [{ scheduled: 4, completed: 4 }, { scheduled: 3, completed: 3 }, { scheduled: 5, completed: 4 }, { scheduled: 6, completed: 6 }],
      adherencePercent: 69.9,
      membersWithPlan: 8,
      followUpCount: 3,
    });
    expect(some.map((c) => [c.code, c.tone])).toEqual([
      ["new_members", "positive"],
      ["coach_consistency", "positive"],
      ["plan_adherence", "neutral"],
      ["follow_ups", "attention"],
    ]);
    expect(some[1].params).toEqual({ count: "2" });
    expect(some[2].params).toEqual({ percent: "69.9", members: "8" });
    expect(buildCards({ ...base, adherencePercent: 70, membersWithPlan: 1 })[0].tone).toBe("positive");

    // all seven rules fire: the 7th is cut, order is kept
    const all = buildCards({
      attendancePercent: 60,
      previousAttendancePercent: 80,
      byWeekday: [{ weekday: 1, percent: 90, sessions: 3 }, { weekday: 2, percent: 30, sessions: 3 }],
      newMembers: 1,
      coaches: [{ scheduled: 4, completed: 4 }],
      adherencePercent: 80,
      membersWithPlan: 2,
      followUpCount: 1,
    });
    expect(all.map((c) => c.code)).toEqual(["best_weekday", "low_weekday", "attendance_trend", "new_members", "coach_consistency", "plan_adherence"]);
    for (const c of all) {
      expect(c.title).toBe(`insights.card.${c.code}`);
      expect(Object.values(c.params).every((v) => typeof v === "string")).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// API on a hand-built database (fixed clock for the library calls, routes for permissions)
// ---------------------------------------------------------------------------------------------

const NOW = new Date("2026-10-31T12:00:00+05:30"); // a Saturday
const P = { from: "2026-10-05", to: "2026-10-18" }; // Monday to Sunday
const q = (o: Record<string, string> = {}) => new URLSearchParams(o);
const utc = (d: string) => new Date(`${d}T00:00:00Z`);
const at = (d: string, t: string) => new Date(`${d}T${t}:00+05:30`);

describe("owner analytics, coaches list and coach stats (local Postgres, own data)", () => {
  let prisma: PrismaClient | null = null;
  const queries = { count: 0 };
  const sfx = Math.random().toString(36).slice(2, 8);
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const authIds: string[] = [];
  const tenantIds: string[] = [];
  let attSeq = 0;

  const mkUser = async (tenantId: string, role: "OWNER" | "COACH" | "CUSTOMER", key: string, name?: string) => {
    const u = await prisma!.user.create({ data: { tenantId, role, email: `${key}-${sfx}@an.example.test`, name: name ?? `Test ${key}` } });
    ids[key] = u.id;
    const token = `an-${key}-${sfx}-${Math.random().toString(36).slice(2)}`;
    const s = await prisma!.authSession.create({
      data: {
        tenantId,
        userId: u.id,
        accessHash: hashToken(token),
        refreshHash: hashToken(`r-${token}`),
        accessExpiresAt: new Date(Date.now() + 3_600_000),
        refreshExpiresAt: new Date(Date.now() + 7_200_000),
      },
    });
    authIds.push(s.id);
    tokens[key] = token;
    return u;
  };

  let A = "";
  const mkMember = async (key: string, joinedOn: string, extra: Record<string, unknown> = {}) => {
    const m = await prisma!.member.create({ data: { tenantId: A, displayName: `Member ${key}`, joinedOn: utc(joinedOn), ...extra } });
    ids[key] = m.id;
  };
  const mkSession = async (key: string, batch: string, date: string, from: string, to: string, status: "SCHEDULED" | "COMPLETED" | "CANCELLED", marks: [string, "PRESENT" | "ABSENT" | "EXCUSED"][] = []) => {
    const b = await prisma!.batch.findUniqueOrThrow({ where: { id: ids[batch] } });
    const s = await prisma!.session.create({
      data: { tenantId: A, batchId: b.id, coachId: b.coachId, startsAt: at(date, from), endsAt: at(date, to), status, ...(status === "COMPLETED" ? { completedAt: at(date, to) } : {}) },
    });
    ids[key] = s.id;
    for (const [m, st] of marks) {
      await prisma!.attendance.create({
        data: {
          tenantId: A,
          sessionId: s.id,
          memberId: ids[m],
          status: st,
          ...(st === "EXCUSED" ? { reason: "ILLNESS" as const } : {}),
          clientId: `an-${sfx}-${attSeq++}`,
          markedById: ids.coachX,
          markedAt: at(date, to),
        },
      });
    }
  };

  beforeAll(async () => {
    prisma = await tryConnect();
    if (!prisma) return;
    const mkTenant = async (slug: string) => {
      const t = await prisma!.tenant.create({ data: { slug: `${slug}-${sfx}`, name: `AN ${slug}` } });
      tenantIds.push(t.id);
      return t.id;
    };
    A = await mkTenant("a");
    const C = await mkTenant("fees");
    const D = await mkTenant("empty");
    const E = await mkTenant("big");

    await mkUser(A, "OWNER", "ownerA");
    await mkUser(A, "COACH", "coachX", "Coach X");
    await mkUser(A, "COACH", "coachY", "Coach Y");
    await mkUser(A, "CUSTOMER", "custA");
    await mkUser(C, "OWNER", "ownerC");
    await mkUser(D, "OWNER", "ownerD");
    await mkUser(D, "COACH", "coachD", "Coach D");
    await mkUser(E, "OWNER", "ownerE");
    await mkUser(E, "COACH", "coachE1", "Coach E1");
    await mkUser(E, "COACH", "coachE2", "Coach E2");

    const venue = await prisma.venue.create({ data: { tenantId: A, name: "Hall" } });
    const sport = await prisma.sport.create({ data: { tenantId: A, slug: "karate", name: "Karate" } });
    const mkBatch = async (key: string, name: string, coachKey: string, kind: "GROUP_CLASS" | "ONE_ON_ONE", capacity: number | null) => {
      ids[key] = (await prisma!.batch.create({ data: { tenantId: A, venueId: venue.id, sportId: sport.id, coachId: ids[coachKey], name, kind, capacity, daysOfWeek: [1], startTime: "10:00", endTime: "11:00" } })).id;
    };
    await mkBatch("bA", "Batch A", "coachX", "GROUP_CLASS", 2);
    await mkBatch("bB", "Batch B", "coachY", "ONE_ON_ONE", null);

    // Members (see the expected numbers below)
    await mkMember("m1", "2026-06-01", { feeStatus: "PAID", feePaidMethod: "CASH", feePaidOn: utc("2026-10-02") });
    await mkMember("m2", "2026-06-15", { feeStatus: "PAID", feePaidMethod: "UPI", feePaidOn: utc("2026-09-15") });
    await mkMember("m3", "2026-09-10", { feeStatus: "DUE", feeDueOn: utc("2026-11-05") });
    await mkMember("m4", "2026-10-07", { feeStatus: "OVERDUE", feeDueOn: utc("2026-10-20") });
    await mkMember("m5", "2026-05-01", { isActive: false, leftOn: utc("2026-10-12"), feeStatus: "OVERDUE", feeDueOn: utc("2026-09-01") });
    await mkMember("m6", "2026-08-01", { isActive: false, leftOn: utc("2026-09-25") });
    await mkMember("m7", "2026-10-08", { isActive: false, leftOn: utc("2026-10-14") });

    const enroll = (b: string, m: string, leftOn?: string) =>
      prisma!.batchMember.create({ data: { tenantId: A, batchId: ids[b], memberId: ids[m], joinedOn: utc("2026-05-01"), ...(leftOn ? { leftOn: utc(leftOn) } : {}) } });
    for (const m of ["m1", "m2", "m3", "m4"]) await enroll("bA", m);
    await enroll("bA", "m5", "2026-10-12");
    await enroll("bA", "m7", "2026-10-14");
    await enroll("bB", "m1");
    await enroll("bB", "m2");

    await prisma.holiday.create({ data: { tenantId: A, date: utc("2026-10-09"), name: "Festival" } });

    // Previous period 09-21..10-04
    await mkSession("Q1", "bA", "2026-09-22", "10:00", "11:00", "COMPLETED", [["m1", "PRESENT"], ["m2", "PRESENT"], ["m3", "PRESENT"], ["m5", "ABSENT"]]);
    await mkSession("Q2", "bA", "2026-09-29", "10:00", "11:00", "COMPLETED", [["m1", "PRESENT"], ["m2", "PRESENT"]]);
    await mkSession("Q3", "bB", "2026-10-01", "10:00", "11:00", "SCHEDULED");
    // Period 10-05..10-18
    await mkSession("S1", "bA", "2026-10-05", "10:00", "11:00", "COMPLETED", [["m1", "PRESENT"], ["m2", "PRESENT"], ["m3", "ABSENT"]]);
    await mkSession("S7", "bB", "2026-10-06", "10:00", "11:00", "COMPLETED", [["m1", "PRESENT"], ["m2", "ABSENT"]]);
    await mkSession("S2", "bA", "2026-10-07", "10:00", "11:00", "COMPLETED", [["m1", "PRESENT"], ["m2", "ABSENT"], ["m3", "EXCUSED"]]);
    await mkSession("S3", "bA", "2026-10-09", "10:00", "11:00", "COMPLETED", [["m1", "ABSENT"], ["m2", "ABSENT"]]); // holiday
    await mkSession("S4", "bA", "2026-10-12", "10:00", "11:00", "CANCELLED");
    await mkSession("S5", "bA", "2026-10-14", "10:00", "11:00", "SCHEDULED"); // never logged
    await mkSession("S6", "bA", "2026-10-16", "10:00", "11:00", "COMPLETED", [["m1", "PRESENT"], ["m2", "PRESENT"], ["m3", "PRESENT"], ["m4", "ABSENT"]]);
    await mkSession("S8", "bB", "2026-10-18", "10:00", "11:00", "COMPLETED", [["m1", "PRESENT"]]);
    // After the period, before "now"
    await mkSession("R1", "bA", "2026-10-20", "10:00", "11:00", "COMPLETED", [["m4", "ABSENT"]]);
    await mkSession("R2", "bA", "2026-10-22", "10:00", "11:00", "COMPLETED", [["m4", "ABSENT"]]);
    await mkSession("U1", "bB", "2026-10-25", "09:00", "10:00", "SCHEDULED");
    await mkSession("R3", "bA", "2026-10-26", "10:00", "11:00", "COMPLETED", [["m4", "ABSENT"], ["m1", "PRESENT"]]);
    await mkSession("U2", "bA", "2026-10-28", "09:00", "10:00", "SCHEDULED");
    await mkSession("U3", "bA", "2026-10-31", "08:00", "09:00", "SCHEDULED");
    await mkSession("U4", "bA", "2026-10-31", "10:30", "11:30", "SCHEDULED"); // ended 30 minutes ago: not unlogged yet
    // Upcoming (now + 7 days = 11-07 12:00)
    await mkSession("N1", "bA", "2026-11-03", "10:00", "11:00", "SCHEDULED");
    await mkSession("N2", "bB", "2026-11-02", "06:00", "08:00", "SCHEDULED");
    await mkSession("N3", "bA", "2026-11-04", "10:00", "11:00", "CANCELLED");
    await mkSession("N4", "bA", "2026-11-20", "10:00", "11:00", "SCHEDULED"); // beyond 7 days

    // Bookings on S1 (capacity 2) and S2
    const book = (s: string, m: string, status: "BOOKED" | "WAITLISTED" | "CANCELLED") =>
      prisma!.sessionBooking.create({ data: { tenantId: A, sessionId: ids[s], memberId: ids[m], status, bookedById: ids.ownerA, ...(status === "WAITLISTED" ? { waitlistPosition: 1 } : {}) } });
    await book("S1", "m1", "BOOKED");
    await book("S1", "m2", "BOOKED");
    await book("S1", "m3", "WAITLISTED");
    await book("S1", "m4", "CANCELLED");
    await book("S2", "m1", "BOOKED");

    // Plan: one daily item. m1 from 10-05, m2 from 10-12, m5 (already left) from 10-13.
    await prisma.exercise.create({ data: { tenantId: A, source: "ORIGINAL", sourceId: `ex-${sfx}`, sportSlug: "karate", name: "Kata", licence: "Original (project)", primaryMuscles: [], secondaryMuscles: [], instructions: [] } });
    const exId = (await prisma.exercise.findFirstOrThrow({ where: { tenantId: A } })).id;
    const plan = await prisma.workoutPlan.create({ data: { tenantId: A, coachId: ids.coachX, title: "Daily kata", cadence: "DAILY", status: "ACTIVE" } });
    const day = await prisma.workoutPlanDay.create({ data: { tenantId: A, planId: plan.id, dayIndex: 1 } });
    const item = await prisma.workoutPlanItem.create({ data: { tenantId: A, dayId: day.id, exerciseId: exId, position: 1, sets: 1, reps: 10 } });
    const assign = async (m: string, startsOn: string) =>
      (await prisma!.planAssignment.create({ data: { tenantId: A, planId: plan.id, memberId: ids[m], assignedById: ids.coachX, startsOn: utc(startsOn), planVersion: 1 } })).id;
    const a1 = await assign("m1", "2026-10-05");
    const a2 = await assign("m2", "2026-10-12");
    await assign("m5", "2026-10-13");
    const log = (a: string, m: string, date: string, status: "COMPLETED" | "SKIPPED") =>
      prisma!.workoutLog.create({ data: { tenantId: A, assignmentId: a, planItemId: item.id, memberId: ids[m], scheduledFor: utc(date), status, clientId: `wl-${sfx}-${attSeq++}`, recordedById: ids.coachX, ...(status === "COMPLETED" ? { completedAt: at(date, "18:00") } : {}) } });
    for (const d of ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"]) await log(a1, "m1", d, "COMPLETED");
    for (const d of ["2026-10-12", "2026-10-13"]) await log(a2, "m2", d, "COMPLETED");
    await log(a2, "m2", "2026-10-14", "SKIPPED");

    // Availability, goals, level promotion
    await prisma.coachAvailability.createMany({
      data: [
        { tenantId: A, coachId: ids.coachX, weekday: 1, startTime: "06:00", endTime: "09:00" },
        { tenantId: A, coachId: ids.coachX, weekday: 3, startTime: "16:00", endTime: "17:30" },
      ],
    });
    await prisma.goal.create({ data: { tenantId: A, memberId: ids.m1, title: "Yellow belt", status: "ACHIEVED", updatedAt: new Date("2026-10-10T08:00:00Z") } });
    await prisma.goal.create({ data: { tenantId: A, memberId: ids.m2, title: "Attend 20", status: "ACTIVE", targetSessions: 20 } });
    const level = await prisma.level.create({ data: { tenantId: A, sportId: sport.id, name: "White", rank: 1 } });
    await prisma.memberLevel.create({ data: { tenantId: A, memberId: ids.m1, levelId: level.id, achievedOn: utc("2026-10-10"), awardedById: ids.coachX } });

    // Fee tenant C: only active members are counted; one waived
    const mkFee = (name: string, extra: Record<string, unknown>) =>
      prisma!.member.create({ data: { tenantId: C, displayName: `Fee ${name}`, joinedOn: utc("2026-01-01"), ...extra } });
    await mkFee("paid-cash", { feeStatus: "PAID", feePaidMethod: "CASH", feePaidOn: utc("2026-10-03") });
    await mkFee("paid-upi", { feeStatus: "PAID", feePaidMethod: "UPI", feePaidOn: utc("2026-10-20") });
    await mkFee("paid-old", { feeStatus: "PAID", feePaidMethod: null, feePaidOn: utc("2026-09-30") });
    await mkFee("due-soon", { feeStatus: "DUE", feeDueOn: utc("2026-11-07") }); // exactly today + 7
    await mkFee("due-later", { feeStatus: "DUE", feeDueOn: utc("2026-11-08") });
    await mkFee("due-past", { feeStatus: "DUE", feeDueOn: utc("2026-10-30") }); // before today: not "next 7 days"
    await mkFee("overdue", { feeStatus: "OVERDUE", feeDueOn: utc("2026-10-01") });
    await mkFee("waived", { feeStatus: "WAIVED" });
    await mkFee("left", { feeStatus: "PAID", feePaidMethod: "CASH", feePaidOn: utc("2026-10-05"), isActive: false, leftOn: utc("2026-10-10") });
    await mkFee("future", { feeStatus: "DUE", joinedOn: utc("2026-12-01") });

    // Big tenant E (same shape as A, many more rows) for the query-count check
    const venueE = await prisma.venue.create({ data: { tenantId: E, name: "Hall E" } });
    const sportE = await prisma.sport.create({ data: { tenantId: E, slug: "gym", name: "Gym" } });
    const bE = [] as string[];
    for (const c of ["coachE1", "coachE2"]) {
      bE.push((await prisma.batch.create({ data: { tenantId: E, venueId: venueE.id, sportId: sportE.id, coachId: ids[c], name: `B ${c}`, kind: "GROUP_CLASS", capacity: 10, daysOfWeek: [1], startTime: "10:00", endTime: "11:00" } })).id);
    }
    const memberIdsE: string[] = [];
    for (let i = 0; i < 40; i++) {
      const m = await prisma.member.create({
        data: { tenantId: E, displayName: `E member ${String(i).padStart(2, "0")}`, joinedOn: utc("2026-07-01"), feeStatus: i % 4 === 0 ? "OVERDUE" : "PAID" },
      });
      memberIdsE.push(m.id);
      await prisma.batchMember.create({ data: { tenantId: E, batchId: bE[i % 2], memberId: m.id, joinedOn: utc("2026-07-01") } });
    }
    for (let i = 0; i < 24; i++) {
      const date = `2026-10-${String(1 + i).padStart(2, "0")}`;
      const s = await prisma.session.create({
        data: { tenantId: E, batchId: bE[i % 2], coachId: ids[i % 2 ? "coachE2" : "coachE1"], startsAt: at(date, "10:00"), endsAt: at(date, "11:00"), status: i < 20 ? "COMPLETED" : "SCHEDULED" },
      });
      if (i < 20) {
        await prisma.attendance.createMany({
          data: memberIdsE.slice(0, 12).map((id, k) => ({ tenantId: E, sessionId: s.id, memberId: id, status: (k + i) % 3 === 0 ? ("ABSENT" as const) : ("PRESENT" as const), clientId: `big-${sfx}-${attSeq++}`, markedById: ids.coachE1 })),
        });
      }
    }
    await prisma.coachAvailability.create({ data: { tenantId: E, coachId: ids.coachE1, weekday: 2, startTime: "08:00", endTime: "12:00" } });
  }, 120_000);

  afterAll(async () => {
    if (!prisma) return;
    await prisma.authSession.deleteMany({ where: { id: { in: authIds } } });
    for (const tenantId of tenantIds) {
      await prisma.memberUpdate.deleteMany({ where: { tenantId } });
      await prisma.workoutLog.deleteMany({ where: { tenantId } });
      await prisma.planAssignment.deleteMany({ where: { tenantId } });
      await prisma.workoutPlan.deleteMany({ where: { tenantId } });
      await prisma.sessionBooking.deleteMany({ where: { tenantId } });
      await prisma.session.deleteMany({ where: { tenantId } });
      await prisma.batch.deleteMany({ where: { tenantId } });
      await prisma.tenant.delete({ where: { id: tenantId } });
    }
    await prisma.$disconnect();
  });

  const scoped = (tenant: "A" | "C" | "D" | "E") => {
    const id = { A, C: tenantIds[1], D: tenantIds[2], E: tenantIds[3] }[tenant];
    return forTenant(prisma!, id);
  };
  const call = async (handler: any, who: string, params: Record<string, string> = {}, route?: Record<string, string>) => {
    const qs = new URLSearchParams(params).toString();
    const res = await handler(
      new Request(`http://localhost/api/v1/x${qs ? `?${qs}` : ""}`, { headers: who ? { authorization: `Bearer ${tokens[who]}` } : {} }),
      route ? { params: Promise.resolve(route) } : undefined,
    );
    return { status: res.status as number, body: (await res.json()) as any };
  };

  // ---- overview ----

  it("overview: hand-computed numbers with excused absences, a holiday, a cancelled session, leavers and a joiner who left", async (ctx) => {
    if (!prisma) return ctx.skip();
    const o: any = await getOwnerOverview(scoped("A"), q(P), NOW);
    expect(validateSchemaName(o, "OwnerOverview")).toEqual([]);
    expect([o.from, o.to]).toEqual([P.from, P.to]);

    // members: 4 active on 10-04 and on 10-18; 2 joined (m4, m7); 2 left (m5, m7)
    expect(o.members.active).toEqual({ value: 4, previous: 4, changePercent: 0 });
    expect(o.members.new).toEqual({ value: 2, previous: 0, changePercent: null });
    expect(o.members.left).toEqual({ value: 2, previous: 1, changePercent: 100 });
    expect(o.members.netGrowthPercent).toEqual({ value: 0, previous: -20, changePercent: null }); // previous: (4 - 5) / 5

    // sessions: S1 S2 S5 S6 S7 S8 scheduled (S3 holiday, S4 cancelled); S5 never logged
    expect(o.sessions.scheduled).toEqual({ value: 6, previous: 3, changePercent: 100 });
    expect(o.sessions.completed).toEqual({ value: 5, previous: 2, changePercent: 150 });
    expect(o.sessions.cancelled).toEqual({ value: 1, previous: 0, changePercent: null });
    expect(o.sessions.unlogged).toEqual({ value: 1, previous: 1, changePercent: 0 });
    expect(o.sessions.completionPercent.value).toBe(83.3);
    expect(o.sessions.completionPercent.previous).toBe(66.7);

    // attendance: present 8, absent 4 (the holiday's two absences and the excused one do not count)
    expect(o.attendance.percent).toMatchObject({ value: 66.7, previous: 83.3, changePercent: -19.9 });
    expect(o.attendance.noShowPercent).toMatchObject({ value: 33.3, previous: 16.7 });
    expect(o.attendance.byWeekday).toEqual([
      { weekday: 1, percent: 66.7, noShowPercent: 33.3, sessions: 1 },
      { weekday: 2, percent: 50, noShowPercent: 50, sessions: 1 },
      { weekday: 3, percent: 50, noShowPercent: 50, sessions: 1 },
      { weekday: 4, percent: null, noShowPercent: null, sessions: 0 },
      { weekday: 5, percent: 75, noShowPercent: 25, sessions: 1 },
      { weekday: 6, percent: null, noShowPercent: null, sessions: 0 },
      { weekday: 7, percent: 100, noShowPercent: 0, sessions: 1 },
    ]);
    expect(o.attendance.byBatch).toEqual([
      { batchId: ids.bA, batchName: "Batch A", sessions: 3, percent: 66.7, noShowPercent: 33.3 },
      { batchId: ids.bB, batchName: "Batch B", sessions: 2, percent: 66.7, noShowPercent: 33.3 },
    ]);

    // engagement: m1 m2 m3 were present in both 14-day windows
    expect(o.engagement.engagedMembers).toMatchObject({ value: 3, previous: 3 });
    expect(o.engagement.percent).toMatchObject({ value: 75, previous: 75 });

    // workouts: m1 14 days + m2 7 days = 21 items; m5's six items after leaving are ignored; 6 completed
    expect(o.workouts.scheduled).toMatchObject({ value: 21, previous: 0 });
    expect(o.workouts.completed).toMatchObject({ value: 6, previous: 0 });
    expect(o.workouts.adherencePercent).toMatchObject({ value: 28.6, previous: null, changePercent: null });
    expect(o.workouts.activeAssignments.value).toBe(2);
    expect(o.workouts.membersWithPlan.value).toBe(2);

    // retention: 3 of the 4 members active on 10-04 are still active on 10-18 (the joiner who left is not a base member)
    expect(o.retention.percent).toMatchObject({ value: 75, previous: 80 });
    expect(o.retention.cohorts.map((c: any) => c.joined)).toEqual([1, 2, 0, 1, 1, 2]);
    expect(o.retention.cohorts[3]).toMatchObject({ month: "2026-08", retained30: 100, retained60: 0, retained90: 0 });

    // bookings: 3 booked, 1 waitlisted, 1 cancelled; capacity 2 x 4 live group classes (S1 S2 S5 S6; S3 holiday, S4 cancelled) = 8
    expect(o.bookings).toEqual({ booked: 3, waitlisted: 1, cancelled: 1, fillPercent: 37.5 });
  });

  it("overview over an empty tenant returns zeros and null percentages, never 0 for nothing to measure", async (ctx) => {
    if (!prisma) return ctx.skip();
    const o: any = await getOwnerOverview(scoped("D"), q(P), NOW);
    expect(validateSchemaName(o, "OwnerOverview")).toEqual([]);
    expect(o.members.active).toEqual({ value: 0, previous: 0, changePercent: null });
    expect(o.members.netGrowthPercent.value).toBeNull();
    expect(o.sessions.scheduled.value).toBe(0);
    expect(o.sessions.completionPercent.value).toBeNull();
    expect(o.attendance.percent.value).toBeNull();
    expect(o.attendance.noShowPercent.value).toBeNull();
    expect(o.attendance.byWeekday.every((w: any) => w.percent === null && w.sessions === 0)).toBe(true);
    expect(o.attendance.byBatch).toEqual([]);
    expect(o.engagement.percent.value).toBeNull();
    expect(o.workouts.adherencePercent.value).toBeNull();
    expect(o.retention.percent.value).toBeNull();
    expect(o.retention.cohorts).toHaveLength(6);
    expect(o.retention.cohorts.every((c: any) => c.joined === 0 && c.retained30 === null)).toBe(true);
    expect(o.bookings).toEqual({ booked: 0, waitlisted: 0, cancelled: 0, fillPercent: null });
  });

  it("a period with sessions but no attendance marks has null attendance, not 0", async (ctx) => {
    if (!prisma) return ctx.skip();
    // 09-30..10-04 holds only Q3 (scheduled, unlogged): nothing completed yet
    const o: any = await getOwnerOverview(scoped("A"), q({ from: "2026-09-30", to: "2026-10-04" }), NOW);
    expect(o.sessions).toMatchObject({ scheduled: { value: 1 }, completed: { value: 0 }, unlogged: { value: 1 } });
    expect(o.sessions.completionPercent.value).toBe(0);
    expect(o.attendance.percent.value).toBeNull();
  });

  // ---- trends ----

  it("trends: weekly buckets ending with the current week, month buckets, empty tenant", async (ctx) => {
    if (!prisma) return ctx.skip();
    const t: any = await getOwnerTrends(scoped("A"), q({ periods: "3" }), NOW);
    expect(validateSchemaName(t, "OwnerTrends")).toEqual([]);
    expect(t.granularity).toBe("week");
    expect(t.points).toEqual([
      { periodStart: "2026-10-12", activeMembers: 4, newMembers: 0, leftMembers: 2, sessionsScheduled: 3, sessionsCompleted: 2, attendancePercent: 80, workoutsCompleted: 2, workoutsScheduled: 14, engagedMembers: 3 },
      { periodStart: "2026-10-19", activeMembers: 4, newMembers: 0, leftMembers: 0, sessionsScheduled: 3, sessionsCompleted: 2, attendancePercent: 0, workoutsCompleted: 0, workoutsScheduled: 14, engagedMembers: 0 },
      { periodStart: "2026-10-26", activeMembers: 4, newMembers: 0, leftMembers: 0, sessionsScheduled: 4, sessionsCompleted: 1, attendancePercent: 50, workoutsCompleted: 0, workoutsScheduled: 12, engagedMembers: 1 },
    ]);

    const m: any = await getOwnerTrends(scoped("A"), q({ granularity: "month", periods: "2" }), NOW);
    expect(m.points.map((p: any) => p.periodStart)).toEqual(["2026-09-01", "2026-10-01"]);
    expect(m.points[1]).toMatchObject({ newMembers: 2, leftMembers: 2 });

    const e: any = await getOwnerTrends(scoped("D"), q(), NOW);
    expect(e.points).toHaveLength(12);
    expect(e.points.every((p: any) => p.activeMembers === 0 && p.attendancePercent === null)).toBe(true);
    expect(validateSchemaName(e, "OwnerTrends")).toEqual([]);
  });

  // ---- coaches ----

  it("coach workload and stats: consistency, attendance, adherence, load, outcomes, weekly series", async (ctx) => {
    if (!prisma) return ctx.skip();
    const w: any = await getCoachWorkload(scoped("A"), q(P), NOW);
    expect(w.items.map((c: any) => c.coachName)).toEqual(["Coach X", "Coach Y"]);
    for (const c of w.items) expect(validateSchemaName(c, "CoachStats")).toEqual([]);
    const [x, y] = w.items;
    expect(x).toMatchObject({
      coachId: ids.coachX,
      batchCount: 1,
      memberCount: 4, // m5 and m7 left the batch, m6 never joined
      sessions: { scheduled: 4, completed: 3, cancelled: 1, unlogged: 1, upcoming7d: 1 }, // N3 cancelled and N4 too far away do not count
      consistencyPercent: 75,
      attendancePercent: 66.7, // P6 A3
      workoutAdherencePercent: 28.6,
      activeAssignments: 2, // m5's assignment does not count, they left
      activePlans: 1,
      availabilityHoursPerWeek: 4.5,
      bookedHoursNext7d: 1,
      loadPercent: 22.2,
      memberOutcomes: { goalsAchieved: 1, goalsActive: 1, levelPromotions: 1 },
    });
    expect(y).toMatchObject({
      batchCount: 1,
      memberCount: 2,
      sessions: { scheduled: 2, completed: 2, cancelled: 0, unlogged: 0, upcoming7d: 1 },
      consistencyPercent: 100,
      attendancePercent: 66.7,
      availabilityHoursPerWeek: 0,
      bookedHoursNext7d: 2,
      loadPercent: null, // no availability set: nothing to measure
      activeAssignments: 0,
      activePlans: 0,
    });
    expect(y.memberOutcomes.levelPromotions).toBe(0);

    // last 8 weeks, oldest first, ending with the current week
    expect(x.weekly).toHaveLength(8);
    expect(x.weekly[0].weekStart).toBe("2026-09-07");
    expect(x.weekly[7].weekStart).toBe("2026-10-26");
    const week = (d: string) => x.weekly.find((r: any) => r.weekStart === d);
    expect(week("2026-09-21")).toEqual({ weekStart: "2026-09-21", scheduled: 1, completed: 1, attendancePercent: 75 });
    expect(week("2026-09-28")).toEqual({ weekStart: "2026-09-28", scheduled: 1, completed: 1, attendancePercent: 100 });
    expect(week("2026-10-05")).toEqual({ weekStart: "2026-10-05", scheduled: 2, completed: 2, attendancePercent: 60 }); // S3 is a holiday
    expect(week("2026-10-12")).toEqual({ weekStart: "2026-10-12", scheduled: 2, completed: 1, attendancePercent: 75 }); // S4 cancelled, S5 unlogged
    expect(week("2026-09-07")).toEqual({ weekStart: "2026-09-07", scheduled: 0, completed: 0, attendancePercent: null });

    // a coach with nothing to measure
    const own: any = await getCoachStats(scoped("D"), { userId: ids.coachD, tenantId: tenantIds[2], role: "coach" }, ids.coachD, q(P), NOW);
    expect(validateSchemaName(own, "CoachStats")).toEqual([]);
    expect(own).toMatchObject({ batchCount: 0, memberCount: 0, consistencyPercent: null, attendancePercent: null, workoutAdherencePercent: null, loadPercent: null });
    expect(own.sessions).toEqual({ scheduled: 0, completed: 0, cancelled: 0, unlogged: 0, upcoming7d: 0 });
  });

  it("coaches list counts batches, members, upcoming sessions and assignments", async (ctx) => {
    if (!prisma) return ctx.skip();
    const l: any = await listCoaches(scoped("A"), NOW);
    for (const c of l.items) expect(validateSchemaName(c, "CoachSummary")).toEqual([]);
    expect(l.items).toEqual([
      { id: ids.coachX, name: "Coach X", batchCount: 1, memberCount: 4, upcomingSessions7d: 1, activeAssignments: 2 },
      { id: ids.coachY, name: "Coach Y", batchCount: 1, memberCount: 2, upcomingSessions7d: 1, activeAssignments: 0 },
    ]);
    expect((await listCoaches(scoped("C"), NOW)).items).toEqual([]);
  });

  // ---- fees ----

  it("fee stats are counts over active members only and carry no amounts", async (ctx) => {
    if (!prisma) return ctx.skip();
    const f: any = await getFeeStats(scoped("C"), NOW);
    expect(validateSchemaName(f, "FeeStats")).toEqual([]);
    expect(f).toEqual({
      asOf: "2026-10-31",
      activeMembers: 8, // the member who left and the one who has not joined yet are not counted
      counts: { paid: 3, due: 3, overdue: 1, waived: 1 },
      dueNext7Days: 1, // only the member due 11-07; due 11-08 is later and due 10-30 is already past
      paidThisMonth: 2,
      paidByMethod: { cash: 1, upi: 1, unknown: 1 },
      paidPercent: 42.9, // 3 / (8 - 1 waived)
    });
    expect(JSON.stringify(f)).not.toMatch(/amount|price|revenue|rupee|inr/i);
    const e: any = await getFeeStats(scoped("D"), NOW);
    expect(e).toMatchObject({ activeMembers: 0, paidPercent: null, counts: { paid: 0, due: 0, overdue: 0, waived: 0 }, dueNext7Days: 0 });
  });

  // ---- insights ----

  it("insights: follow-ups (worst first), renewals with 30-day attendance, unlogged sessions, cards", async (ctx) => {
    if (!prisma) return ctx.skip();
    const i: any = await getOwnerInsights(scoped("A"), NOW);
    expect(validateSchemaName(i, "OwnerInsights")).toEqual([]);
    expect(i.generatedAt).toBe(NOW.toISOString());

    expect(i.followUps).toEqual([
      // four marked absences in a row (R3 R2 R1 S6); the three before that do not matter
      { memberId: ids.m4, memberName: "Member m4", reason: "consecutive_absences", detail: 4, coachName: "Coach X" },
      // last activity 10-16, 15 days ago; same day count, then by name
      { memberId: ids.m2, memberName: "Member m2", reason: "inactive_14_days", detail: 15, coachName: "Coach X" },
      { memberId: ids.m3, memberName: "Member m3", reason: "inactive_14_days", detail: 15, coachName: "Coach X" },
      // m1 is present (10-26) but completed none of 14 scheduled workouts in the last 14 days: 0%
      { memberId: ids.m1, memberName: "Member m1", reason: "workouts_pending", detail: 0, coachName: "Coach X" },
    ]);
    // the member who left (m5) is not flagged even though they owe fees

    expect(i.renewals).toEqual([
      { memberId: ids.m4, memberName: "Member m4", feeStatus: "overdue", feeDueOn: "2026-10-20", attendancePercent30d: 0 }, // S6 R1 R2 R3 all absent
      { memberId: ids.m3, memberName: "Member m3", feeStatus: "due", feeDueOn: "2026-11-05", attendancePercent30d: 50 }, // S1 absent, S2 excused (ignored), S6 present
    ]);

    // last 14 days only (S5 on 10-14 is too old), more than 2 hours after the end (U4 ended 30 minutes ago)
    expect(i.unloggedSessions).toEqual([
      { sessionId: ids.U3, batchName: "Batch A", coachName: "Coach X", startsAt: at("2026-10-31", "08:00").toISOString(), isGroupClass: true },
      { sessionId: ids.U2, batchName: "Batch A", coachName: "Coach X", startsAt: at("2026-10-28", "09:00").toISOString(), isGroupClass: true },
      { sessionId: ids.U1, batchName: "Batch B", coachName: "Coach Y", startsAt: at("2026-10-25", "09:00").toISOString(), isGroupClass: false },
    ]);

    const codes = i.cards.map((c: any) => c.code);
    expect(codes).toContain("new_members");
    expect(i.cards.length).toBeLessThanOrEqual(6);
    for (const c of i.cards) {
      expect(["positive", "neutral", "attention"]).toContain(c.tone);
      expect(c.title).toMatch(/^insights\.card\./);
    }
    expect(JSON.stringify(i.cards)).not.toMatch(/surveil|accountab|penalt/i);
  });

  it("insights on an empty tenant are empty lists and no cards", async (ctx) => {
    if (!prisma) return ctx.skip();
    const i: any = await getOwnerInsights(scoped("D"), NOW);
    expect(validateSchemaName(i, "OwnerInsights")).toEqual([]);
    expect([i.followUps, i.renewals, i.unloggedSessions, i.cards]).toEqual([[], [], [], []]);
  });

  // ---- HTTP: permissions, validation, tenant isolation, contract ----

  const ownerOps: [string, any, Record<string, string>?][] = [
    ["overview", overviewRoute],
    ["trends", trendsRoute],
    ["workload", workloadRoute],
    ["fees", feesRoute],
    ["insights", insightsRoute],
    ["coaches", coachesRoute],
  ];

  it("requires a sign-in, and only the owner may use the owner endpoints (coach and customer get 403)", async (ctx) => {
    if (!prisma) return ctx.skip();
    for (const [name, handler] of ownerOps) {
      expect((await call(handler, "")).status, `${name} anonymous`).toBe(401);
      for (const who of ["coachX", "custA"]) {
        const r = await call(handler, who);
        expect(r.status, `${name} ${who}`).toBe(403);
        expect(validateSchemaName(r.body, "Error")).toEqual([]);
      }
      expect((await call(handler, "ownerA")).status, `${name} owner`).toBe(200);
    }
  });

  it("coach stats: owner any coach, a coach only themselves, customer 403, anonymous 401, other tenant 404", async (ctx) => {
    if (!prisma) return ctx.skip();
    const stats = (who: string, coach: string, params: Record<string, string> = {}) =>
      call(coachStatsRoute, who, params, { coachId: ids[coach] ?? coach });
    expect((await stats("", "coachX")).status).toBe(401);
    expect((await stats("custA", "coachX")).status).toBe(403);
    expect((await stats("coachY", "coachX")).status).toBe(403); // another coach's record
    const self = await stats("coachX", "coachX", P);
    expect(self.status).toBe(200);
    expect(validateSchemaName(self.body, "CoachStats")).toEqual([]);
    expect(self.body.coachId).toBe(ids.coachX);
    expect(self.body.sessions.completed).toBe(3);
    const asOwner = await stats("ownerA", "coachY", P);
    expect(asOwner.status).toBe(200);
    expect(asOwner.body.coachName).toBe("Coach Y");
    // not a coach (owner id), unknown id and another tenant's coach are all 404 and look the same
    expect((await stats("ownerA", "ownerA")).status).toBe(404);
    expect((await stats("ownerA", "nope")).status).toBe(404);
    expect((await stats("ownerD", "coachX")).status).toBe(404);
    expect((await stats("coachD", "coachX")).status).toBe(404);
    expect((await stats("ownerA", "coachD")).status).toBe(404);
  });

  it("every response matches the contract and nothing leaks across tenants", async (ctx) => {
    if (!prisma) return ctx.skip();
    const pairs: [any, string, Record<string, string>][] = [
      [overviewRoute, "OwnerOverview", P],
      [trendsRoute, "OwnerTrends", { granularity: "month", periods: "4" }],
      [feesRoute, "FeeStats", {}],
      [insightsRoute, "OwnerInsights", {}],
    ];
    for (const [handler, schema, params] of pairs) {
      for (const who of ["ownerA", "ownerD", "ownerC", "ownerE"]) {
        const r = await call(handler, who, params);
        expect(r.status, `${schema} ${who}`).toBe(200);
        expect(validateSchemaName(r.body, schema), `${schema} ${who}`).toEqual([]);
      }
    }
    // default range: the last 30 days ending today, no params needed
    const def = await call(overviewRoute, "ownerA");
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    expect(def.body.to).toBe(today);
    expect(def.body.from).toBe(new Date(new Date(`${today}T00:00:00Z`).getTime() - 29 * 86_400_000).toISOString().slice(0, 10));

    const w = await call(workloadRoute, "ownerA", P);
    expect(w.body.items).toHaveLength(2);
    for (const c of w.body.items) expect(validateSchemaName(c, "CoachStats")).toEqual([]);
    const list = await call(coachesRoute, "ownerA");
    expect(list.body.items.map((c: any) => c.name)).toEqual(["Coach X", "Coach Y"]);
    // tenant D sees only its own coach and none of A's numbers
    expect((await call(coachesRoute, "ownerD")).body.items.map((c: any) => c.name)).toEqual(["Coach D"]);
    const d = await call(overviewRoute, "ownerD", P);
    expect(d.body.sessions.scheduled.value).toBe(0);
    expect(d.body.members.active.value).toBe(0);
    expect((await call(workloadRoute, "ownerD", P)).body.items.map((c: any) => c.coachName)).toEqual(["Coach D"]);
    // the same range over the route (real clock) gives the same numbers as the fixed clock for past data
    expect((await call(overviewRoute, "ownerA", P)).body.sessions.scheduled.value).toBe(6);
  });

  it("validates dates, range length, granularity and periods with 400", async (ctx) => {
    if (!prisma) return ctx.skip();
    const bad: [any, Record<string, string>, string?][] = [
      [overviewRoute, { from: "2026-13-01" }],
      [overviewRoute, { from: "yesterday" }],
      [overviewRoute, { to: "20261018" }],
      [overviewRoute, { from: "2026-10-18", to: "2026-10-05" }],
      [overviewRoute, { from: "2025-01-01", to: "2026-10-18" }], // more than 366 days
      [workloadRoute, { from: "bad" }],
      [workloadRoute, { from: "2026-10-18", to: "2026-10-05" }],
      [trendsRoute, { granularity: "day" }],
      [trendsRoute, { periods: "1" }],
      [trendsRoute, { periods: "25" }],
      [trendsRoute, { periods: "abc" }],
      [trendsRoute, { periods: "3.5" }],
    ];
    for (const [handler, params] of bad) {
      const r = await call(handler, "ownerA", params);
      expect(r.status, JSON.stringify(params)).toBe(400);
      expect(r.body.error.code).toBe("validation_failed");
      expect(validateSchemaName(r.body, "Error")).toEqual([]);
    }
    const stats = await call(coachStatsRoute, "ownerA", { to: "nope" }, { coachId: ids.coachX });
    expect(stats.status).toBe(400);
    expect((await call(coachStatsRoute, "ownerA", { from: "2026-10-18", to: "2026-10-05" }, { coachId: ids.coachX })).status).toBe(400);
    // exactly a year is fine
    expect((await call(overviewRoute, "ownerA", { from: "2025-10-18", to: "2026-10-18" })).status).toBe(200);
    expect((await call(trendsRoute, "ownerA", { periods: "24" })).status).toBe(200);
    expect((await call(trendsRoute, "ownerA", { periods: "2", granularity: "week" })).status).toBe(200);
  });

  it("main aggregations use grouped queries: query count does not grow with the number of rows", async (ctx) => {
    if (!prisma) return ctx.skip();
    const counting = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
    (counting as any).$on("query", () => {
      queries.count += 1;
    });
    try {
      const measure = async (tenant: number, run: (db: ReturnType<typeof forTenant>) => Promise<unknown>) => {
        queries.count = 0;
        await run(forTenant(counting, tenantIds[tenant]));
        return queries.count;
      };
      const runs: [string, (db: any) => Promise<unknown>][] = [
        ["overview", (db) => getOwnerOverview(db, q({ from: "2026-10-01", to: "2026-10-24" }), NOW)],
        ["trends", (db) => getOwnerTrends(db, q({ periods: "6" }), NOW)],
        ["workload", (db) => getCoachWorkload(db, q({ from: "2026-10-01", to: "2026-10-24" }), NOW)],
        ["insights", (db) => getOwnerInsights(db, NOW)],
        ["fees", (db) => getFeeStats(db, NOW)],
        ["coaches", (db) => listCoaches(db, NOW)],
      ];
      for (const [name, run] of runs) {
        const small = await measure(0, run); // tenant A: 7 members, ~25 sessions
        const big = await measure(3, run); // tenant E: 40 members, 24 sessions, 240 attendance rows
        expect(big, `${name} small=${small} big=${big}`).toBeLessThanOrEqual(small + 4);
        expect(big, name).toBeLessThan(45);
      }
    } finally {
      await counting.$disconnect();
    }
  });
});
