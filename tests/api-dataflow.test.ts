/**
 * STAR-74: cross-role data flow at API level. One role writes through the real route handlers,
 * the other roles read the effect through their own endpoints.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { tryConnect } from "./helpers-db";
import { validateSchemaName } from "./contract-schema";
import { buildWorld, call, d, dayMs, uniq, type Handler, type World } from "./helpers-api";
import { POST as createPlan } from "../app/api/v1/workout-plans/route";
import { PUT as putPlan } from "../app/api/v1/workout-plans/[planId]/route";
import { POST as archivePlan } from "../app/api/v1/workout-plans/[planId]/archive/route";
import { GET as listAssignments, POST as createAssignments } from "../app/api/v1/plan-assignments/route";
import { GET as getSchedule } from "../app/api/v1/members/[memberId]/schedule/route";
import { GET as getStats } from "../app/api/v1/members/[memberId]/stats/route";
import { GET as listUpdates } from "../app/api/v1/members/[memberId]/updates/route";
import { PUT as putLog } from "../app/api/v1/workout-logs/route";
import { PUT as putAttendance } from "../app/api/v1/sessions/[sessionId]/attendance/route";
import { GET as getSession } from "../app/api/v1/sessions/[sessionId]/route";
import { POST as book } from "../app/api/v1/sessions/[sessionId]/bookings/route";
import { POST as cancel } from "../app/api/v1/bookings/[bookingId]/cancel/route";
import { PUT as putSettings } from "../app/api/v1/tenant/settings/route";
import { GET as overviewRoute } from "../app/api/v1/analytics/overview/route";
import { GET as workloadRoute } from "../app/api/v1/analytics/coaches/route";
import { GET as coachStatsRoute } from "../app/api/v1/coaches/[coachId]/stats/route";

/* eslint-disable @typescript-eslint/no-explicit-any */
const val = (k: any) => (k && typeof k === "object" && "value" in k ? k.value : k);

describe("cross-role data flow (local Postgres)", () => {
  let prisma: PrismaClient | null = null;
  let w: World;
  const s: Record<string, any> = {};

  beforeAll(async () => {
    prisma = await tryConnect();
    if (!prisma) return;
    w = await buildWorld(prisma, "qa74flow");
  });
  afterAll(async () => {
    if (!prisma) return;
    await w?.cleanup();
    await prisma.$disconnect();
  });

  // Flow actors: coachX runs batch2, whose only member is m2, a customer with her own login ("stranger").
  const coach = () => w.A.token.coachX;
  const cust = () => w.A.token.stranger;
  const owner = () => w.A.token.owner;
  const m2 = () => w.A.ids.m2;
  const get = (h: Handler, path: string, token: string, params: Record<string, string> = {}) => call(h, "GET", path, token, { params });
  const overview = async () => (await call(overviewRoute, "GET", "/analytics/overview", owner())).body;
  const feed = async (kind?: string) => {
    const r = await get(listUpdates, `/members/${m2()}/updates`, cust(), { memberId: m2() });
    expect(r.status).toBe(200);
    expect(validateSchemaName(r.body, "MemberUpdatePage")).toEqual([]);
    return kind ? (r.body.items as any[]).filter((u) => u.kind === kind) : (r.body.items as any[]);
  };
  const scheduleItems = async (date: string) => {
    const r = await get(getSchedule, `/members/${m2()}/schedule?from=${date}&to=${date}`, cust(), { memberId: m2() });
    expect(r.status, r.text).toBe(200);
    expect(validateSchemaName(r.body, "MemberSchedule")).toEqual([]);
    return (r.body.days.find((x: any) => x.date === date)?.items ?? []) as any[];
  };
  const stats = async (token: string) => (await get(getStats, `/members/${m2()}/stats`, token, { memberId: m2() })).body;
  const planBody = (title: string) => ({
    title,
    cadence: "daily",
    days: [{ dayIndex: 1, title: "Daily", items: [{ exerciseId: w.A.ids.exA, position: 1, sets: 3, reps: 10 }, { exerciseId: w.A.ids.exB, position: 2, durationSeconds: 45 }] }],
  });

  it("coach creates a plan and assigns it: the customer sees the assignment, today's items, stats and a plan_assigned update", async (ctx) => {
    if (!prisma) return ctx.skip();
    expect(await feed("plan_assigned")).toEqual([]);
    expect((await scheduleItems(d(0)))).toEqual([]);
    const before = (await stats(cust())).workouts.scheduled;

    const plan = await call(createPlan, "POST", "/workout-plans", coach(), { body: planBody("Flow plan") });
    expect(plan.status).toBe(201);
    s.plan = plan.body;
    // Not visible to the customer until it is assigned.
    expect((await get(listAssignments, "/plan-assignments", cust())).body.items).toEqual([]);

    const asg = await call(createAssignments, "POST", "/plan-assignments", coach(), { body: { planId: plan.body.id, memberIds: [m2()], startsOn: d(-2), note: "Start today" } });
    expect(asg.status).toBe(201);
    s.assignment = asg.body.items[0];

    const mine = await get(listAssignments, "/plan-assignments", cust());
    expect(validateSchemaName(mine.body, "PlanAssignmentPage")).toEqual([]);
    expect(mine.body.items.map((a: any) => [a.id, a.planId, a.memberId, a.status])).toEqual([[s.assignment.id, plan.body.id, m2(), "active"]]);
    // The owner sees it too; another family does not.
    expect((await get(listAssignments, "/plan-assignments", owner())).body.items.some((a: any) => a.id === s.assignment.id)).toBe(true);
    expect((await get(listAssignments, "/plan-assignments", w.A.token.parent)).body.items.some((a: any) => a.id === s.assignment.id)).toBe(false);

    const items = await scheduleItems(d(0));
    expect(items.map((i) => [i.planTitle, i.exerciseName, i.status])).toEqual([["Flow plan", "Front kick A", "pending"], ["Flow plan", "Plank hold A", "pending"]]);
    s.items = items;
    expect((await stats(cust())).workouts.scheduled).toBe(before + 6); // startsOn is two days back: three days, two items a day
    const a = await feed("plan_assigned");
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ memberId: m2(), entityType: "assignment", entityId: s.assignment.id, read: false });
    expect(JSON.stringify(a[0].params)).toContain("Flow plan");
    expect(JSON.stringify(a)).not.toContain("QA Kid");
  });

  it("customer logs workouts: member stats, coach stats and owner analytics reflect them", async (ctx) => {
    if (!prisma) return ctx.skip();
    const ownerBefore = val((await overview()).workouts.completed);
    const memberBefore = (await stats(coach())).workouts.completed;
    const logFor = (item: any, action: string) => ({ clientId: `flow-${uniq()}`, assignmentId: s.assignment.id, planItemId: item.planItemId, scheduledFor: d(0), action });
    const done = await call(putLog, "PUT", "/workout-logs", cust(), { body: logFor(s.items[0], "complete") });
    expect(done.status, done.text).toBe(200);
    expect((await call(putLog, "PUT", "/workout-logs", cust(), { body: logFor(s.items[1], "start") })).status).toBe(200);

    const itemsNow = await scheduleItems(d(0));
    expect(itemsNow.map((i) => i.status)).toEqual(["completed", "started"]);
    const forCoach = await stats(coach());
    const forCust = await stats(cust());
    expect(forCoach.workouts.completed).toBe(memberBefore + 1);
    expect(forCust.workouts.completed).toBe(memberBefore + 1);
    expect(forCust.workouts.pending).toBeGreaterThanOrEqual(1);
    expect(forCust.workouts.adherencePercent).toBeGreaterThan(0);
    expect(forCust.streaks.currentActiveDays).toBeGreaterThanOrEqual(1);
    expect(val((await overview()).workouts.completed)).toBe(ownerBefore + 1);
    const cs = await call(coachStatsRoute, "GET", `/coaches/${w.A.user.coachX}/stats`, coach(), { params: { coachId: w.A.user.coachX } });
    expect(cs.status).toBe(200);
    expect(validateSchemaName(cs.body, "CoachStats")).toEqual([]);
    expect(cs.body.workoutAdherencePercent ?? cs.body.workouts?.adherencePercent ?? null).not.toBeNull();
    // Another coach never sees this member's log counts through the member endpoint.
    expect((await get(getStats, `/members/${m2()}/stats`, w.A.token.coach, { memberId: m2() })).status).toBe(403);
  });

  it("coach edits the plan: the customer's feed gets plan_updated; the schedule shows the new exercise list", async (ctx) => {
    if (!prisma) return ctx.skip();
    expect(await feed("plan_updated")).toEqual([]);
    const body = { ...planBody("Flow plan v2"), expectedVersion: s.plan.version };
    body.days[0].items.push({ exerciseId: w.A.ids.exA, position: 3, sets: 2, reps: 5 });
    const upd = await call(putPlan, "PUT", "", coach(), { params: { planId: s.plan.id }, body });
    expect(upd.status, upd.text).toBe(200);
    const u = await feed("plan_updated");
    expect(u).toHaveLength(1);
    expect(JSON.stringify(u[0].params)).toContain("Flow plan v2");
    expect(u[0].read).toBe(false);
    expect(u[0].title).toContain("Flow plan v2");
    // Edited-away items that already have a log stay on the days they were logged (history);
    // everything else is the new list: three live items plus the two logged ones.
    const today = await scheduleItems(d(0));
    expect(today.length).toBe(5);
    expect(today.filter((i) => i.logId === null).map((i) => i.position).sort()).toEqual([1, 2, 3]);
    expect(await scheduleItems(d(1))).toHaveLength(3);
  });

  it("coach archives the plan: the customer's schedule empties from tomorrow, the assignment ends, history stays readable", async (ctx) => {
    if (!prisma) return ctx.skip();
    expect(await feed("plan_ended")).toEqual([]);
    const arch = await call(archivePlan, "POST", "", coach(), { params: { planId: s.plan.id } });
    expect(arch.status, arch.text).toBe(200);
    // The assignment ends today (inclusive): today keeps what was scheduled, tomorrow onward is empty.
    expect((await scheduleItems(d(0))).length).toBe(5);
    expect(await scheduleItems(d(1))).toEqual([]);
    expect(await scheduleItems(d(3))).toEqual([]);
    const asg = await get(listAssignments, "/plan-assignments", cust());
    expect(asg.body.items.map((a: any) => [a.id, a.status])).toEqual([[s.assignment.id, "ended"]]);
    expect(await feed("plan_ended")).toHaveLength(1);
    const after = (await stats(cust())).workouts;
    expect(after.upcoming ?? 0).toBe(0);
    // The customer can still open the archived plan they were assigned.
    const asPlan = await call((await import("../app/api/v1/workout-plans/[planId]/route")).GET, "GET", "", cust(), { params: { planId: s.plan.id } });
    expect(asPlan.status).toBe(200);
  });

  it("roll call by the coach updates the member's attendance stats and the owner overview", async (ctx) => {
    if (!prisma) return ctx.skip();
    const start = new Date(Date.now() - 30 * 3_600_000);
    const sess = await prisma.session.create({ data: { tenantId: w.A.id, batchId: w.A.ids.batch2, coachId: w.A.user.coachX, startsAt: start, endsAt: new Date(start.getTime() + 3_600_000) } });
    const mBefore = (await stats(cust())).attendance;
    const oBefore = await overview();
    const ownerSessions = val(oBefore.sessions.completed);

    const roll = await call(putAttendance, "PUT", "", coach(), {
      params: { sessionId: sess.id },
      body: { entries: [{ memberId: m2(), status: "present", clientId: `flow-${uniq()}` }], complete: true },
    });
    expect(roll.status, roll.text).toBe(200);

    const mAfter = (await stats(cust())).attendance;
    expect(mAfter.attended).toBe(mBefore.attended + 1);
    expect(mAfter.percent).toBe(100);
    expect(mAfter.hoursAttended).toBeCloseTo((mBefore.hoursAttended ?? 0) + 1, 1);
    const oAfter = await overview();
    expect(val(oAfter.sessions.completed)).toBe(ownerSessions + 1);
    expect(val(oAfter.attendance.percent)).toBe(100);
    expect(val(oAfter.attendance.noShowPercent)).toBe(0);
    // Marking absent on a second session moves the no-show rate off zero, for owner and member alike.
    const start2 = new Date(Date.now() - 52 * 3_600_000);
    const sess2 = await prisma.session.create({ data: { tenantId: w.A.id, batchId: w.A.ids.batch2, coachId: w.A.user.coachX, startsAt: start2, endsAt: new Date(start2.getTime() + 3_600_000) } });
    const miss = await call(putAttendance, "PUT", "", coach(), { params: { sessionId: sess2.id }, body: { entries: [{ memberId: m2(), status: "absent", clientId: `flow-${uniq()}` }], complete: true } });
    expect(miss.status, miss.text).toBe(200);
    expect((await stats(cust())).attendance).toMatchObject({ attended: mBefore.attended + 1, missed: mBefore.missed + 1, percent: 50 });
    expect(val((await overview()).attendance.noShowPercent)).toBe(50);
    const workload = await call(workloadRoute, "GET", "/analytics/coaches", owner());
    expect(workload.status).toBe(200);
    const row = (workload.body.items ?? workload.body.coaches ?? workload.body).find((r: any) => (r.coachId ?? r.id) === w.A.user.coachX);
    expect(row).toBeTruthy();
    // The customer's own session view shows their attendance, never the roster.
    const detail = await call(getSession, "GET", "", cust(), { params: { sessionId: sess.id } });
    expect(detail.body.myAttendance).toEqual([{ memberId: m2(), attendance: "present" }]);
    expect(detail.body.roster).toBeUndefined();
  });

  it("a booking on a full session is waitlisted, and a cancellation promotes it with an update to the promoted member", async (ctx) => {
    if (!prisma) return ctx.skip();
    const start = new Date(Date.now() + 5 * dayMs);
    const sess = await prisma.session.create({ data: { tenantId: w.A.id, batchId: w.A.ids.batch2, coachId: w.A.user.coachX, startsAt: start, endsAt: new Date(start.getTime() + 3_600_000), capacity: 1 } });
    const extra = await prisma.member.create({ data: { tenantId: w.A.id, displayName: "QA Extra Member", joinedOn: new Date(`${d(-30)}T00:00:00Z`) } });
    await prisma.batchMember.create({ data: { tenantId: w.A.id, batchId: w.A.ids.batch2, memberId: extra.id, joinedOn: new Date(`${d(-30)}T00:00:00Z`) } });
    const bookFor = (token: string, memberId: string) => call(book, "POST", "", token, { params: { sessionId: sess.id }, body: { memberId } });
    const first = await bookFor(coach(), extra.id);
    expect(first.status).toBe(201);
    expect(first.body.status).toBe("booked");
    const second = await bookFor(cust(), m2());
    expect(second.status).toBe(201);
    expect(second.body).toMatchObject({ status: "waitlisted", waitlistPosition: 1 });
    expect(validateSchemaName(second.body, "Booking")).toEqual([]);

    // The waitlisted customer sees only her own place, never the other member's name.
    const view = await call(getSession, "GET", "", cust(), { params: { sessionId: sess.id } });
    expect(view.status).toBe(200);
    expect(view.body.myBookings.map((b: any) => [b.memberId, b.status, b.waitlistPosition])).toEqual([[m2(), "waitlisted", 1]]);
    expect(view.text).not.toContain("QA Extra");
    expect(await feed("waitlist_promoted")).toEqual([]);

    const gone = await call(cancel, "POST", "", owner(), { params: { bookingId: first.body.id } });
    expect(gone.status, gone.text).toBe(200);
    expect(gone.body.status).toBe("cancelled");
    const after = await call(getSession, "GET", "", cust(), { params: { sessionId: sess.id } });
    expect(after.body.myBookings.map((b: any) => [b.status, b.waitlistPosition])).toEqual([["booked", null]]);
    const promoted = await feed("waitlist_promoted");
    expect(promoted).toHaveLength(1);
    expect(promoted[0]).toMatchObject({ entityType: "booking", entityId: second.body.id });
    expect(JSON.stringify(promoted[0])).not.toContain("QA Extra");
    // The coach's roster counts agree.
    const coachView = await call(getSession, "GET", "", coach(), { params: { sessionId: sess.id } });
    expect(coachView.body).toMatchObject({ bookedCount: 1, waitlistCount: 0 });
  });

  it("owner settings change the cancel-window outcome", async (ctx) => {
    if (!prisma) return ctx.skip();
    const start = new Date(Date.now() + 90 * 60_000);
    const sess = await prisma.session.create({ data: { tenantId: w.A.id, batchId: w.A.ids.batch1, coachId: w.A.user.coach, startsAt: start, endsAt: new Date(start.getTime() + 3_600_000) } });
    const b = await call(book, "POST", "", w.A.token.parent, { params: { sessionId: sess.id }, body: { memberId: w.A.ids.kid } });
    expect(b.status, b.text).toBe(201);
    // Default window is 120 minutes: 90 minutes before the start is too late for a customer.
    expect(b.body.cancellableUntil).toBe(new Date(start.getTime() - 120 * 60_000).toISOString());
    const late = await call(cancel, "POST", "", w.A.token.parent, { params: { bookingId: b.body.id } });
    expect(late.status).toBe(409);
    expect(validateSchemaName(late.body, "Error")).toEqual([]);
    // A coach of tenant B and a customer cannot change the rule.
    expect((await call(putSettings, "PUT", "/tenant/settings", w.A.token.parent, { body: { bookingCancelWindowMinutes: 30 } })).status).toBe(403);
    expect((await call(putSettings, "PUT", "/tenant/settings", w.A.token.coach, { body: { bookingCancelWindowMinutes: 30 } })).status).toBe(403);
    const set = await call(putSettings, "PUT", "/tenant/settings", owner(), { body: { bookingCancelWindowMinutes: 30 } });
    expect(set.status).toBe(200);
    // Tenant B's window is untouched.
    const bSettings = await prisma.tenantSettings.findUnique({ where: { tenantId: w.B.id } });
    expect(bSettings?.bookingCancelWindowMinutes ?? 120).toBe(120);
    const ok = await call(cancel, "POST", "", w.A.token.parent, { params: { bookingId: b.body.id } });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body.status).toBe("cancelled");
    // And a stricter window blocks again.
    expect((await call(putSettings, "PUT", "/tenant/settings", owner(), { body: { bookingCancelWindowMinutes: 120 } })).status).toBe(200);
    const b2 = await call(book, "POST", "", w.A.token.parent, { params: { sessionId: sess.id }, body: { memberId: w.A.ids.kid } });
    expect(b2.status).toBe(201);
    expect((await call(cancel, "POST", "", w.A.token.parent, { params: { bookingId: b2.body.id } })).status).toBe(409);
  });

  it("none of the above is visible in tenant B's analytics or feeds", async (ctx) => {
    if (!prisma) return ctx.skip();
    const ob = (await call(overviewRoute, "GET", "/analytics/overview", w.B.token.owner)).body;
    expect(val(ob.attendance.percent) ?? 0).toBe(0);
    expect(val(ob.workouts.completed) ?? 0).toBe(0);
    const bFeed = await call(listUpdates, "GET", "", w.B.token.parent, { params: { memberId: w.B.ids.kid } });
    expect(JSON.stringify(bFeed.body)).not.toContain("Flow plan");
  });
});
