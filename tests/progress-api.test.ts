import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { hashToken } from "../lib/auth/tokens";
import { tryConnect } from "./helpers-db";
import { validateSchemaName } from "./contract-schema";
import { computeGoalProgress, type GoalInputs, type ProgressFacts } from "../lib/api/goals";
import { computeStreaks, pct, weekStartOf } from "../lib/api/member-stats";
import { updateTitle } from "../lib/api/member-updates";
import { parseRange } from "../lib/api/schedule";
import { nextStatus } from "../lib/api/workout-logs";
import { POST as createPlan } from "../app/api/v1/workout-plans/route";
import { GET as getPlan, PUT as putPlan } from "../app/api/v1/workout-plans/[planId]/route";
import { POST as createAssignments } from "../app/api/v1/plan-assignments/route";
import { PATCH as patchAssignment } from "../app/api/v1/plan-assignments/[assignmentId]/route";
import { GET as getSchedule } from "../app/api/v1/members/[memberId]/schedule/route";
import { GET as listLogs } from "../app/api/v1/members/[memberId]/workout-logs/route";
import { GET as getStats } from "../app/api/v1/members/[memberId]/stats/route";
import { GET as listGoals, POST as createGoal } from "../app/api/v1/members/[memberId]/goals/route";
import { GET as listUpdates } from "../app/api/v1/members/[memberId]/updates/route";
import { POST as markRead } from "../app/api/v1/members/[memberId]/updates/read/route";
import { PUT as putLog } from "../app/api/v1/workout-logs/route";
import { PATCH as patchGoal } from "../app/api/v1/goals/[goalId]/route";
import { POST as addCheckIn } from "../app/api/v1/goals/[goalId]/check-ins/route";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Handler = (...args: any[]) => Promise<Response>;

const suffix = Date.now().toString(36);
const dayMs = 86_400_000;
const todayStr = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
/** Date n days from today (tenant calendar). */
const d = (n: number) => new Date(new Date(`${todayStr()}T00:00:00Z`).getTime() + n * dayMs).toISOString().slice(0, 10);
const at = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`);
const utcDate = (date: string) => new Date(`${date}T00:00:00Z`);

describe("pure formulas", () => {
  it("pct rounds to one decimal and is null for an empty denominator", () => {
    expect(pct(1, 3)).toBe(33.3);
    expect(pct(2, 3)).toBe(66.7);
    expect(pct(0, 5)).toBe(0);
    expect(pct(0, 0)).toBeNull();
  });

  it("weekStartOf is the Monday of the ISO week", () => {
    expect(weekStartOf("2026-11-23")).toBe("2026-11-23"); // Monday
    expect(weekStartOf("2026-11-29")).toBe("2026-11-23"); // Sunday
    expect(weekStartOf("2026-12-01")).toBe("2026-11-30");
  });

  it("computeStreaks: current counts back from today or yesterday, longest is the best run", () => {
    const today = "2026-11-20";
    expect(computeStreaks([], today)).toEqual({ current: 0, longest: 0 });
    expect(computeStreaks(["2026-11-20"], today)).toEqual({ current: 1, longest: 1 });
    // nothing yet today: yesterday keeps the streak alive
    expect(computeStreaks(["2026-11-17", "2026-11-18", "2026-11-19"], today)).toEqual({ current: 3, longest: 3 });
    // a gap of one full day breaks it
    expect(computeStreaks(["2026-11-17", "2026-11-18"], today)).toEqual({ current: 0, longest: 2 });
    // longest run is in the past
    expect(computeStreaks(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-19", "2026-11-20", "2026-11-20"], today)).toEqual({ current: 2, longest: 4 });
    // future dates are ignored
    expect(computeStreaks(["2026-11-21"], today)).toEqual({ current: 0, longest: 0 });
  });

  const facts = (over: Partial<ProgressFacts> = {}): ProgressFacts => ({ presentAt: [], completedOn: [], levels: [], ...over });
  const goal = (over: Partial<GoalInputs>): GoalInputs => ({
    metric: "SESSIONS_ATTENDED",
    status: "ACTIVE",
    startsOn: "2026-11-01",
    targetValue: null,
    targetSessions: null,
    startValue: null,
    targetLevel: null,
    latestCheckIn: null,
    ...over,
  });

  it("goal progress: sessions attended counts PRESENT since startsOn, falls back to targetSessions, caps at 100", () => {
    const f = facts({ presentAt: [at("2026-10-30", "10:00"), at("2026-11-01", "06:00"), at("2026-11-05", "10:00"), at("2026-11-06", "10:00")] });
    expect(computeGoalProgress(goal({ targetValue: 4 }), f)).toEqual({ currentValue: 3, progressPercent: 75 });
    expect(computeGoalProgress(goal({ targetSessions: 6 }), f)).toEqual({ currentValue: 3, progressPercent: 50 });
    expect(computeGoalProgress(goal({ targetValue: 2 }), f)).toEqual({ currentValue: 3, progressPercent: 100 });
    // no sessions yet and no target: zero, never NaN
    expect(computeGoalProgress(goal({ targetValue: 5 }), facts())).toEqual({ currentValue: 0, progressPercent: 0 });
    expect(computeGoalProgress(goal({}), f).progressPercent).toBe(0);
  });

  it("goal progress: workouts completed since startsOn", () => {
    const f = facts({ completedOn: ["2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03"] });
    expect(computeGoalProgress(goal({ metric: "WORKOUTS_COMPLETED", targetValue: 6 }), f)).toEqual({ currentValue: 3, progressPercent: 50 });
    expect(computeGoalProgress(goal({ metric: "WORKOUTS_COMPLETED", targetValue: null }), f).progressPercent).toBe(0);
  });

  it("goal progress: level uses rank at startsOn and is 100 once reached", () => {
    const levels = [
      { sportId: "s", rank: 1, achievedOn: "2026-01-01" },
      { sportId: "s", rank: 2, achievedOn: "2026-11-10" },
      { sportId: "other", rank: 9, achievedOn: "2026-01-01" },
    ];
    const base = goal({ metric: "LEVEL", startsOn: "2026-11-01", targetLevel: { rank: 3, sportId: "s" } });
    expect(computeGoalProgress(base, facts({ levels }))).toEqual({ currentValue: 2, progressPercent: 50 });
    expect(computeGoalProgress(base, facts({ levels: [...levels, { sportId: "s", rank: 3, achievedOn: "2026-11-15" }] }))).toEqual({ currentValue: 3, progressPercent: 100 });
    // already past the target before the goal started: still 100
    expect(computeGoalProgress({ ...base, targetLevel: { rank: 1, sportId: "s" } }, facts({ levels })).progressPercent).toBe(100);
    // no level at all in this sport yet
    expect(computeGoalProgress(base, facts())).toEqual({ currentValue: 0, progressPercent: 0 });
  });

  it("goal progress: custom works for increasing and decreasing targets and clamps", () => {
    const inc = goal({ metric: "CUSTOM", startValue: 10, targetValue: 20 });
    expect(computeGoalProgress(inc, facts())).toEqual({ currentValue: null, progressPercent: 0 });
    expect(computeGoalProgress({ ...inc, latestCheckIn: 15 }, facts()).progressPercent).toBe(50);
    expect(computeGoalProgress({ ...inc, latestCheckIn: 25 }, facts()).progressPercent).toBe(100);
    expect(computeGoalProgress({ ...inc, latestCheckIn: 5 }, facts()).progressPercent).toBe(0);
    const dec = goal({ metric: "CUSTOM", startValue: 20, targetValue: 15 });
    expect(computeGoalProgress({ ...dec, latestCheckIn: 17.5 }, facts()).progressPercent).toBe(50);
    expect(computeGoalProgress({ ...dec, latestCheckIn: 14 }, facts()).progressPercent).toBe(100);
    expect(computeGoalProgress({ ...dec, latestCheckIn: 22 }, facts()).progressPercent).toBe(0);
    // target equal to start never divides by zero
    expect(computeGoalProgress(goal({ metric: "CUSTOM", startValue: 5, targetValue: 5, latestCheckIn: 5 }), facts()).progressPercent).toBe(100);
    expect(computeGoalProgress(goal({ metric: "CUSTOM", startValue: 5, targetValue: 5, latestCheckIn: 6 }), facts()).progressPercent).toBe(0);
    // no start value means a baseline of 0
    expect(computeGoalProgress(goal({ metric: "CUSTOM", targetValue: 8, latestCheckIn: 2 }), facts()).progressPercent).toBe(25);
  });

  it("goal progress: achieved is always 100, dropped keeps the computed value", () => {
    const f = facts({ presentAt: [at("2026-11-05", "10:00")] });
    expect(computeGoalProgress(goal({ targetValue: 10, status: "ACHIEVED" }), f).progressPercent).toBe(100);
    expect(computeGoalProgress(goal({ targetValue: 10, status: "DROPPED" }), f).progressPercent).toBe(10);
  });

  it("workout log transitions follow the contract table", () => {
    expect(nextStatus(null, "start")).toBe("STARTED");
    expect(nextStatus(null, "complete")).toBe("COMPLETED");
    expect(nextStatus(null, "skip")).toBe("SKIPPED");
    expect(nextStatus(null, "stop")).toBeNull();
    expect(nextStatus("STARTED", "stop")).toBe("STOPPED");
    expect(nextStatus("STARTED", "complete")).toBe("COMPLETED");
    expect(nextStatus("STARTED", "start")).toBe("same");
    expect(nextStatus("STARTED", "skip")).toBeNull();
    expect(nextStatus("STOPPED", "start")).toBe("STARTED");
    expect(nextStatus("STOPPED", "complete")).toBe("COMPLETED");
    expect(nextStatus("STOPPED", "stop")).toBe("same");
    expect(nextStatus("COMPLETED", "complete")).toBe("same");
    for (const a of ["start", "stop", "skip"] as const) expect(nextStatus("COMPLETED", a)).toBeNull();
    expect(nextStatus("SKIPPED", "skip")).toBe("same");
    for (const a of ["start", "stop", "complete"] as const) expect(nextStatus("SKIPPED", a)).toBeNull();
  });

  it("parseRange applies defaults, keeps the span on a lone bound and rejects bad ranges", () => {
    const q = (s: string) => new URLSearchParams(s);
    expect(parseRange(q(""), "2026-11-20", { from: 0, to: 6 }, 62)).toEqual({ from: "2026-11-20", to: "2026-11-26" });
    expect(parseRange(q("from=2026-11-01"), "2026-11-20", { from: 0, to: 6 }, 62)).toEqual({ from: "2026-11-01", to: "2026-11-07" });
    expect(parseRange(q(""), "2026-11-20", { from: -29, to: 0 }, 366)).toEqual({ from: "2026-10-22", to: "2026-11-20" });
    expect(() => parseRange(q("from=2026-11-20&to=2026-11-19"), "2026-11-20", { from: 0, to: 6 }, 62)).toThrow();
    expect(() => parseRange(q("from=2026-01-01&to=2026-03-04"), "2026-11-20", { from: 0, to: 6 }, 62)).toThrow(); // 63 days
    expect(parseRange(q("from=2026-01-01&to=2026-03-03"), "2026-11-20", { from: 0, to: 6 }, 62)).toEqual({ from: "2026-01-01", to: "2026-03-03" }); // 62 days
    expect(() => parseRange(q("from=2026-02-30"), "2026-11-20", { from: 0, to: 6 }, 62)).toThrow();
  });

  it("update titles read in English from kind and params", () => {
    expect(updateTitle("PLAN_UPDATED", { planTitle: "Home circuit" })).toBe("Your plan Home circuit was updated");
    expect(updateTitle("GOAL_SET", { goalTitle: "Yellow belt" })).toBe("New goal: Yellow belt");
    expect(updateTitle("SESSION_CANCELLED", {})).toBe("A session was cancelled");
  });
});

describe("progress API: logs, schedule, stats, goals, updates (local Postgres, scratch data)", () => {
  let prisma: PrismaClient | null = null;
  const tokens: Record<string, string> = {};
  const sessionIds: string[] = [];
  const tenants: string[] = [];
  const id: Record<string, string> = {};
  let it1 = "";
  let it2 = "";

  async function user(tenantId: string, role: "OWNER" | "COACH" | "CUSTOMER", key: string) {
    return prisma!.user.create({ data: { tenantId, role, email: `${key}-${suffix}@progress.example.test`, name: `User ${key}` } });
  }
  async function login(label: string, u: { id: string; tenantId: string }) {
    const token = `progress-${label}-${Math.random().toString(36).slice(2)}-${Date.now()}`;
    const s = await prisma!.authSession.create({
      data: {
        tenantId: u.tenantId,
        userId: u.id,
        accessHash: hashToken(token),
        refreshHash: hashToken(`r-${token}`),
        accessExpiresAt: new Date(Date.now() + 3_600_000),
        refreshExpiresAt: new Date(Date.now() + 7_200_000),
      },
    });
    sessionIds.push(s.id);
    tokens[label] = token;
  }
  async function call(handler: Handler, method: string, path: string, who?: string, opts: { body?: unknown; params?: Record<string, string> } = {}) {
    const headers: Record<string, string> = who ? { authorization: `Bearer ${tokens[who]}` } : {};
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    const req = new Request(`http://localhost/api/v1${path}`, {
      method,
      headers,
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
    const res = await handler(req, { params: Promise.resolve(opts.params ?? {}) });
    const text = await res.text();
    return { status: res.status, body: text ? (JSON.parse(text) as any) : null };
  }
  const ok = (body: unknown, schema: string) => expect(validateSchemaName(body, schema)).toEqual([]);
  const m = (member: string) => ({ memberId: id[member] });
  const get = (h: Handler, sub: string, who: string | undefined, member: string, q = "") => call(h, "GET", `/members/${id[member]}/${sub}${q}`, who, { params: m(member) });
  const put = (who: string | undefined, body: unknown) => call(putLog, "PUT", "/workout-logs", who, { body });
  const act = (action: string, extra: Record<string, unknown> = {}) => ({
    clientId: `cid-${Math.random().toString(36).slice(2)}-${suffix}`,
    assignmentId: id.asgM1,
    planItemId: it1,
    scheduledFor: d(0),
    action,
    ...extra,
  });

  beforeAll(async () => {
    prisma = await tryConnect();
    if (!prisma) return;
    const A = (await prisma.tenant.create({ data: { slug: `prog-a-${suffix}`, name: "Progress A" } })).id;
    const B = (await prisma.tenant.create({ data: { slug: `prog-b-${suffix}`, name: "Progress B" } })).id;
    tenants.push(A, B);
    id.A = A;
    id.B = B;

    const owner = await user(A, "OWNER", "owner");
    const coach1 = await user(A, "COACH", "coach1");
    const coach2 = await user(A, "COACH", "coach2");
    const cust = await user(A, "CUSTOMER", "cust");
    const parent = await user(A, "CUSTOMER", "parent");
    const other = await user(A, "CUSTOMER", "other");
    const ownerB = await user(B, "OWNER", "ownerb");
    Object.assign(id, { owner: owner.id, coach1: coach1.id, coach2: coach2.id, cust: cust.id });

    const venue = await prisma.venue.create({ data: { tenantId: A, name: "Hall" } });
    const sport = await prisma.sport.create({ data: { tenantId: A, slug: "karate", name: "Karate" } });
    const levels = [] as { id: string }[];
    for (const [rank, name] of [[1, "White"], [2, "Yellow"], [3, "Green"]] as const) {
      levels.push(await prisma.level.create({ data: { tenantId: A, sportId: sport.id, name, rank } }));
    }
    id.lvlGreen = levels[2].id;
    id.lvlB = (await prisma.level.create({ data: { tenantId: B, sportId: (await prisma.sport.create({ data: { tenantId: B, slug: "kb", name: "KB" } })).id, name: "Foreign", rank: 1 } })).id;

    const mkBatch = (coachId: string, name: string) =>
      prisma!.batch.create({ data: { tenantId: A, venueId: venue.id, sportId: sport.id, coachId, name, daysOfWeek: [1, 3], startTime: "17:00", endTime: "18:00" } });
    const b1 = await mkBatch(coach1.id, "Coach1 batch");
    const b2 = await mkBatch(coach2.id, "Coach2 batch");
    id.b1 = b1.id;
    id.b2 = b2.id;

    const guardian = await prisma.guardian.create({ data: { tenantId: A, userId: parent.id, name: "Parent Guardian" } });
    const mk = (displayName: string, extra: object = {}) => prisma!.member.create({ data: { tenantId: A, displayName, ...extra } });
    const m1 = await mk("Adult One", { userId: cust.id });
    const kid = await mk("Kid One", { isMinor: true, guardianId: guardian.id });
    const m2 = await mk("Member Two");
    const m3 = await mk("Member Three");
    const stranger = await mk("Stranger", { userId: other.id });
    Object.assign(id, { m1: m1.id, kid: kid.id, m2: m2.id, m3: m3.id, stranger: stranger.id });
    for (const [batchId, memberId] of [[b1.id, m1.id], [b1.id, kid.id], [b1.id, m3.id], [b2.id, m2.id]]) {
      await prisma.batchMember.create({ data: { tenantId: A, batchId, memberId, joinedOn: utcDate(d(-60)) } });
    }
    await prisma.memberLevel.create({ data: { tenantId: A, memberId: m1.id, levelId: levels[0].id, achievedOn: utcDate(d(-40)) } });
    await prisma.memberLevel.create({ data: { tenantId: A, memberId: m1.id, levelId: levels[1].id, achievedOn: utcDate(d(-20)) } });

    for (const [label, u] of [["owner", owner], ["coach1", coach1], ["coach2", coach2], ["cust", cust], ["parent", parent], ["other", other], ["ownerB", ownerB]] as const) {
      await login(label, u);
    }
    id.exA = (await prisma.exercise.create({ data: { tenantId: A, source: "ORIGINAL", sourceId: "fk", sportSlug: "karate", name: "Front kick", licence: "Original (project)", primaryMuscles: ["quadriceps"], instructions: ["Kick"] } })).id;
    id.exB = (await prisma.exercise.create({ data: { tenantId: A, source: "ORIGINAL", sourceId: "ph", sportSlug: "general", name: "Plank hold", licence: "Original (project)", primaryMuscles: ["abdominals"], instructions: ["Hold"] } })).id;

    // Daily plan (every date scheduled) with two items, built through the real plan API.
    const plan = await call(createPlan, "POST", "/workout-plans", "coach1", {
      body: {
        title: "Daily moves",
        cadence: "daily",
        days: [{ dayIndex: 1, title: "Daily", items: [{ exerciseId: id.exA, position: 1, sets: 3, reps: 10 }, { exerciseId: id.exB, position: 2, durationSeconds: 45 }] }],
      },
    });
    expect(plan.status).toBe(201);
    id.plan = plan.body.id;
    it1 = plan.body.days[0].items[0].id;
    it2 = plan.body.days[0].items[1].id;
    const made = await call(createAssignments, "POST", "/plan-assignments", "coach1", { body: { planId: id.plan, memberIds: [id.m1, id.m3], startsOn: d(-10) } });
    expect(made.status).toBe(201);
    id.asgM1 = made.body.items.find((a: any) => a.memberId === id.m1).id;
    id.asgM3 = made.body.items.find((a: any) => a.memberId === id.m3).id;
    // m3's assignment is paused: it must schedule nothing
    expect((await call(patchAssignment, "PATCH", "", "coach1", { params: { assignmentId: id.asgM3 }, body: { status: "paused" } })).status).toBe(200);
    // another coach's plan, to prove an unrelated item id is not schedulable
    const plan2 = await call(createPlan, "POST", "/workout-plans", "coach2", {
      body: { title: "Other", cadence: "daily", days: [{ dayIndex: 1, items: [{ exerciseId: id.exA, position: 1, reps: 5 }] }] },
    });
    id.foreignItem = plan2.body.days[0].items[0].id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.authSession.deleteMany({ where: { id: { in: sessionIds } } });
    for (const t of tenants) {
      await prisma.workoutLog.deleteMany({ where: { tenantId: t } });
      await prisma.planAssignment.deleteMany({ where: { tenantId: t } });
      await prisma.workoutPlan.deleteMany({ where: { tenantId: t } });
      await prisma.session.deleteMany({ where: { tenantId: t } });
      await prisma.batch.deleteMany({ where: { tenantId: t } });
      await prisma.tenant.delete({ where: { id: t } });
    }
    await prisma.$disconnect();
  });

  it("needs a session and the right role; owners and coaches cannot mark updates read or log as the owner", async (ctx) => {
    if (!prisma) return ctx.skip();
    for (const [h, sub] of [[getSchedule, "schedule"], [listLogs, "workout-logs"], [getStats, "stats"], [listGoals, "goals"], [listUpdates, "updates"]] as const) {
      expect((await get(h, sub, undefined, "m1")).status).toBe(401);
    }
    expect((await put(undefined, act("start"))).status).toBe(401);
    // customers cannot manage goals
    expect((await call(createGoal, "POST", "", "cust", { params: m("m1"), body: { title: "x", metric: "custom", targetValue: 1 } })).status).toBe(403);
    expect((await call(patchGoal, "PATCH", "", "cust", { params: { goalId: "x" }, body: { title: "x" } })).status).toBe(403);
    expect((await call(addCheckIn, "POST", "", "cust", { params: { goalId: "x" }, body: { value: 1 } })).status).toBe(403);
    // only customers mark read
    for (const who of ["owner", "coach1"]) {
      expect((await call(markRead, "POST", "", who, { params: m("m1"), body: { upTo: new Date().toISOString() } })).status).toBe(403);
    }
    // the owner has no recordWorkoutLog access
    expect((await put("owner", act("start"))).status).toBe(403);
  });

  it("row-level access: customer self or child, coach own members, owner all, other tenant 404", async (ctx) => {
    if (!prisma) return ctx.skip();
    const reads: [Handler, string][] = [[getSchedule, "schedule"], [listLogs, "workout-logs"], [getStats, "stats"], [listGoals, "goals"], [listUpdates, "updates"]];
    for (const [h, sub] of reads) {
      expect((await get(h, sub, "cust", "m1")).status, `cust ${sub}`).toBe(200);
      expect((await get(h, sub, "parent", "kid")).status, `parent ${sub}`).toBe(200);
      expect((await get(h, sub, "parent", "m1")).status, `parent->m1 ${sub}`).toBe(403);
      expect((await get(h, sub, "cust", "kid")).status, `cust->kid ${sub}`).toBe(403);
      expect((await get(h, sub, "other", "m1")).status, `other ${sub}`).toBe(403);
      expect((await get(h, sub, "coach1", "m1")).status, `coach1 ${sub}`).toBe(200);
      expect((await get(h, sub, "coach2", "m1")).status, `coach2 ${sub}`).toBe(403);
      expect((await get(h, sub, "coach2", "m2")).status, `coach2 own ${sub}`).toBe(200);
      expect((await get(h, sub, "owner", "m2")).status, `owner ${sub}`).toBe(200);
      expect((await get(h, sub, "ownerB", "m1")).status, `tenant B ${sub}`).toBe(404);
    }
    expect((await call(getStats, "GET", "", "owner", { params: { memberId: "does-not-exist" } })).status).toBe(404);
    // goals: coach manages only members in own batches
    const body = { title: "Goal", metric: "sessions_attended", targetValue: 5 };
    expect((await call(createGoal, "POST", "", "coach2", { params: m("m1"), body })).status).toBe(403);
    expect((await call(createGoal, "POST", "", "ownerB", { params: m("m1"), body })).status).toBe(404);
    expect((await call(markRead, "POST", "", "other", { params: m("m1"), body: { upTo: new Date().toISOString() } })).status).toBe(403);
    expect((await call(markRead, "POST", "", "cust", { params: m("kid"), body: { upTo: new Date().toISOString() } })).status).toBe(403);
    expect((await call(markRead, "POST", "", "ownerB", { params: m("m1"), body: { upTo: new Date().toISOString() } })).status).toBe(403); // policy: customers only
  });

  it("schedule: dated items from the plan, sessions, bookings, holidays, paused assignments", async (ctx) => {
    if (!prisma) return ctx.skip();
    // sessions: one in the member's batch, one group class of another batch with a live booking for the kid
    const own = await prisma.session.create({ data: { tenantId: id.A, batchId: id.b1, coachId: id.coach1, startsAt: at(d(2), "17:00"), endsAt: at(d(2), "18:00") } });
    const cancelled = await prisma.session.create({ data: { tenantId: id.A, batchId: id.b1, coachId: id.coach1, startsAt: at(d(3), "17:00"), endsAt: at(d(3), "18:00"), status: "CANCELLED" } });
    const foreign = await prisma.session.create({ data: { tenantId: id.A, batchId: id.b2, coachId: id.coach2, startsAt: at(d(4), "17:00"), endsAt: at(d(4), "18:00") } });
    await prisma.sessionBooking.create({ data: { tenantId: id.A, sessionId: foreign.id, memberId: id.kid, status: "BOOKED", bookedById: id.coach2 } });
    await prisma.sessionBooking.create({ data: { tenantId: id.A, sessionId: foreign.id, memberId: id.m1, status: "WAITLISTED", waitlistPosition: 1, bookedById: id.coach2 } });
    await prisma.holiday.create({ data: { tenantId: id.A, date: utcDate(d(2)), name: "Festival Day" } });

    const r = await get(getSchedule, "schedule", "cust", "m1", `?from=${d(-1)}&to=${d(4)}`);
    expect(r.status).toBe(200);
    ok(r.body, "MemberSchedule");
    expect(r.body.days.map((x: any) => x.date)).toEqual([-1, 0, 1, 2, 3, 4].map(d));
    const day = (n: number) => r.body.days.find((x: any) => x.date === d(n));
    expect(day(0).items.map((i: any) => i.exerciseName)).toEqual(["Front kick", "Plank hold"]);
    expect(day(0).items[0]).toMatchObject({ assignmentId: id.asgM1, planItemId: it1, sets: 3, reps: 10, status: "pending", logId: null });
    expect(day(0).dayTitle).toBe("Daily");
    expect(day(2).isHoliday).toBe(true);
    expect(day(2).holidayName).toBe("Festival Day");
    expect(day(2).items).toHaveLength(2); // holidays do not remove home workouts
    expect(day(1).isHoliday).toBe(false);
    expect(day(1).holidayName).toBeNull();
    expect(day(2).sessions.map((s: any) => s.id)).toEqual([own.id]);
    expect(day(3).sessions.map((s: any) => [s.id, s.status])).toEqual([[cancelled.id, "cancelled"]]);
    // m1 is only waitlisted for the other batch's session: it shows with that status
    expect(day(4).sessions.map((s: any) => [s.id, s.myBookingStatus])).toEqual([[foreign.id, "waitlisted"]]);
    expect(day(4).sessions[0].attendanceSummary).toBeNull();
    expect(typeof r.body.unreadUpdates).toBe("number");

    const kidView = await get(getSchedule, "schedule", "parent", "kid", `?from=${d(4)}&to=${d(4)}`);
    ok(kidView.body, "MemberSchedule");
    expect(kidView.body.days[0].sessions[0]).toMatchObject({ id: foreign.id, myBookingStatus: "booked", bookedCount: 1, waitlistCount: 1 });
    expect(kidView.body.days[0].items).toEqual([]); // the kid holds no plan

    // not before the assignment starts, and a paused assignment schedules nothing
    const before = await get(getSchedule, "schedule", "coach1", "m1", `?from=${d(-12)}&to=${d(-9)}`);
    expect(before.body.days.map((x: any) => x.items.length)).toEqual([0, 0, 2, 2]);
    const paused = await get(getSchedule, "schedule", "coach1", "m3", `?from=${d(0)}&to=${d(1)}`);
    expect(paused.body.days.every((x: any) => x.items.length === 0)).toBe(true);

    // default range is today .. today + 6; coach and owner see the roll-call summary
    const def = await get(getSchedule, "schedule", "owner", "m1");
    expect(def.body.from).toBe(d(0));
    expect(def.body.to).toBe(d(6));
    expect(def.body.days).toHaveLength(7);

    for (const q of [`?from=${d(0)}&to=${d(-1)}`, `?from=${d(0)}&to=${d(62)}`, "?from=2026-02-30", "?to=soon"]) {
      const bad = await get(getSchedule, "schedule", "coach1", "m1", q);
      expect(bad.status, q).toBe(400);
      expect(bad.body.error.code).toBe("validation_failed");
    }
    expect((await get(getSchedule, "schedule", "coach1", "m1", `?from=${d(0)}&to=${d(61)}`)).status).toBe(200); // exactly 62 days
  });

  it("member stats: attendance, excused and holiday handling, workouts, streaks, level, weekly", async (ctx) => {
    if (!prisma) return ctx.skip();
    // d-5 is a holiday: its absence must not count as missed
    await prisma.holiday.create({ data: { tenantId: id.A, date: utcDate(d(-5)), name: "Holiday Five" } });
    const att: [number, "PRESENT" | "ABSENT" | "EXCUSED"][] = [[-9, "PRESENT"], [-8, "PRESENT"], [-7, "ABSENT"], [-6, "EXCUSED"], [-5, "ABSENT"], [-4, "PRESENT"]];
    for (const [n, status] of att) {
      const s = await prisma.session.create({ data: { tenantId: id.A, batchId: id.b1, coachId: id.coach1, startsAt: at(d(n), "17:00"), endsAt: at(d(n), "18:00"), status: "COMPLETED" } });
      await prisma.attendance.create({
        data: { tenantId: id.A, sessionId: s.id, memberId: id.m1, status, reason: status === "EXCUSED" ? "EXAM" : null, clientId: `att-${n}-${suffix}`, markedById: id.coach1 },
      });
    }
    // a session that is still SCHEDULED is not counted, even with a mark on it
    const open = await prisma.session.create({ data: { tenantId: id.A, batchId: id.b1, coachId: id.coach1, startsAt: at(d(-3), "17:00"), endsAt: at(d(-3), "18:00") } });
    await prisma.attendance.create({ data: { tenantId: id.A, sessionId: open.id, memberId: id.m1, status: "ABSENT", clientId: `att-open-${suffix}`, markedById: id.coach1 } });

    // logs: completed on d-1 (both), d-2, d-3, d-4 (item 1); skipped d-2 (item 2) and d-5 (item 1)
    const log = (n: number, item: string, status: "COMPLETED" | "SKIPPED") =>
      prisma!.workoutLog.create({
        data: {
          tenantId: id.A,
          assignmentId: id.asgM1,
          planItemId: item,
          memberId: id.m1,
          scheduledFor: utcDate(d(n)),
          status,
          completedAt: status === "COMPLETED" ? at(d(n), "12:00") : null,
          clientId: `seed-${n}-${item}-${suffix}`,
          recordedById: id.cust,
        } as never,
      });
    await log(-1, it1, "COMPLETED");
    await log(-1, it2, "COMPLETED");
    await log(-2, it1, "COMPLETED");
    await log(-2, it2, "SKIPPED");
    await log(-3, it1, "COMPLETED");
    await log(-4, it1, "COMPLETED");
    await log(-5, it1, "SKIPPED");

    const r = await get(getStats, "stats", "cust", "m1");
    expect(r.status).toBe(200);
    ok(r.body, "MemberStats");
    expect(r.body.from).toBe(d(-29));
    expect(r.body.to).toBe(d(0));
    // attended d-9, d-8, d-4; missed d-7 only (d-5 is a holiday, d-3 is not a completed session); excused d-6
    expect(r.body.attendance).toEqual({ attended: 3, missed: 1, excused: 1, percent: 75, hoursAttended: 3 });
    // 11 dates (d-10..d0) x 2 items; 5 completed, 2 skipped, rest pending
    expect(r.body.workouts).toEqual({ scheduled: 22, completed: 5, pending: 15, skipped: 2, adherencePercent: 22.7, upcoming: 0 });
    // active days: d-9, d-8, d-4, d-3, d-2, d-1 (not today yet): current 4, longest 4
    expect(r.body.streaks).toEqual({ currentActiveDays: 4, longestActiveDays: 4 });
    expect(r.body.level).toEqual({ name: "Yellow", rank: 2, nextName: "Green", progressPercent: 66.7 });
    expect(r.body.goals).toEqual({ active: 0, achieved: 0 });
    const w = r.body.weekly;
    expect(w.length).toBeGreaterThanOrEqual(5);
    expect(w.every((x: any, i: number) => weekStartOf(x.weekStart) === x.weekStart && (i === 0 || w[i - 1].weekStart < x.weekStart))).toBe(true);
    const sum = (k: string) => w.reduce((n: number, x: any) => n + x[k], 0);
    expect([sum("attended"), sum("missed"), sum("workoutsCompleted"), sum("workoutsScheduled")]).toEqual([3, 1, 5, 22]);

    // a narrower window and upcoming items
    const win = await get(getStats, "stats", "coach1", "m1", `?from=${d(-4)}&to=${d(3)}`);
    ok(win.body, "MemberStats");
    expect(win.body.attendance).toMatchObject({ attended: 1, missed: 0, excused: 0, percent: 100, hoursAttended: 1 });
    expect(win.body.workouts).toMatchObject({ scheduled: 10, completed: 5, skipped: 1, pending: 4, upcoming: 6 });
    // a future-only window has nothing scheduled yet: percentages are null, never NaN or 0
    const future = await get(getStats, "stats", "coach1", "m1", `?from=${d(1)}&to=${d(5)}`);
    expect(future.body.attendance).toEqual({ attended: 0, missed: 0, excused: 0, percent: null, hoursAttended: 0 });
    expect(future.body.workouts).toEqual({ scheduled: 0, completed: 0, pending: 0, skipped: 0, adherencePercent: null, upcoming: 10 });

    // a member with no sessions, no plan, no level: all-empty but valid
    const empty = await get(getStats, "stats", "owner", "stranger");
    ok(empty.body, "MemberStats");
    expect(empty.body.attendance).toEqual({ attended: 0, missed: 0, excused: 0, percent: null, hoursAttended: 0 });
    expect(empty.body.workouts).toEqual({ scheduled: 0, completed: 0, pending: 0, skipped: 0, adherencePercent: null, upcoming: 0 });
    expect(empty.body.streaks).toEqual({ currentActiveDays: 0, longestActiveDays: 0 });
    expect(empty.body.level).toBeNull();
    expect(empty.body.weekly.every((x: any) => x.attended === 0 && x.workoutsScheduled === 0)).toBe(true);

    for (const q of [`?from=${d(0)}&to=${d(-1)}`, `?from=${d(-400)}&to=${d(0)}`, "?to=2026-13-01"]) {
      expect((await get(getStats, "stats", "owner", "m1", q)).status, q).toBe(400);
    }
  });

  it("workout log history: newest first, paged, filtered, with names", async (ctx) => {
    if (!prisma) return ctx.skip();
    const all = await get(listLogs, "workout-logs", "cust", "m1");
    expect(all.status).toBe(200);
    ok(all.body, "WorkoutLogPage");
    expect(all.body.items).toHaveLength(7);
    expect(all.body.items[0].scheduledFor).toBe(d(-1));
    expect(all.body.items[0]).toMatchObject({ planTitle: "Daily moves", memberId: id.m1 });
    expect(["Front kick", "Plank hold"]).toContain(all.body.items[0].exerciseName);
    const p1 = await get(listLogs, "workout-logs", "cust", "m1", "?limit=3");
    expect(p1.body.items).toHaveLength(3);
    expect(p1.body.nextCursor).toBeTruthy();
    const p2 = await get(listLogs, "workout-logs", "cust", "m1", `?limit=3&cursor=${p1.body.nextCursor}`);
    expect(p2.body.items[0].id).toBe(all.body.items[3].id);
    expect((await get(listLogs, "workout-logs", "cust", "m1", `?from=${d(-2)}&to=${d(-2)}`)).body.items).toHaveLength(2);
    expect((await get(listLogs, "workout-logs", "cust", "m1", "?limit=0")).status).toBe(400);
    expect((await get(listLogs, "workout-logs", "cust", "m1", `?from=${d(0)}&to=${d(-3)}`)).status).toBe(400);
    expect((await get(listLogs, "workout-logs", "cust", "m1", "?from=nope")).status).toBe(400);
    expect((await get(listLogs, "workout-logs", "owner", "m2")).body.items).toEqual([]);
  });

  it("goals: create per metric, computed progress, validation, rules, check-ins", async (ctx) => {
    if (!prisma) return ctx.skip();
    const post = (who: string, body: unknown, member = "m1") => call(createGoal, "POST", "", who, { params: m(member), body });

    // validation
    const bad = async (body: unknown, field: string, who = "coach1") => {
      const r = await post(who, body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.body.error.code).toBe("validation_failed");
      expect(JSON.stringify(r.body.error.details)).toContain(field);
    };
    await bad({ metric: "custom", targetValue: 1 }, "title");
    await bad({ title: "", metric: "custom", targetValue: 1 }, "title");
    await bad({ title: "x".repeat(121), metric: "custom", targetValue: 1 }, "title");
    await bad({ title: "x", metric: "steps", targetValue: 1 }, "metric");
    await bad({ title: "x", metric: "sessions_attended" }, "targetValue");
    await bad({ title: "x", metric: "sessions_attended", targetValue: 0 }, "targetValue");
    await bad({ title: "x", metric: "workouts_completed", targetValue: -1 }, "targetValue");
    await bad({ title: "x", metric: "custom" }, "targetValue");
    await bad({ title: "x", metric: "sessions_attended", targetValue: 5, startValue: 1 }, "startValue");
    await bad({ title: "x", metric: "level" }, "targetLevelId");
    await bad({ title: "x", metric: "custom", targetValue: 5, targetLevelId: id.lvlGreen }, "targetLevelId");
    await bad({ title: "x", metric: "level", targetLevelId: id.lvlB }, "targetLevelId"); // another tenant's level
    await bad({ title: "x", metric: "custom", targetValue: 5, unit: "u".repeat(21) }, "unit");
    await bad({ title: "x", metric: "custom", targetValue: 5, targetDate: "soon" }, "targetDate");
    await bad({ title: "x", metric: "custom", targetValue: "5" }, "targetValue");
    expect(await prisma!.goal.count({ where: { tenantId: id.A } })).toBe(0);

    const g1 = await post("coach1", { title: "Attend 6 classes", metric: "sessions_attended", targetValue: 6, startsOn: d(-9) });
    expect(g1.status).toBe(201);
    ok(g1.body, "Goal");
    expect(g1.body).toMatchObject({ metric: "sessions_attended", status: "active", targetValue: 6, currentValue: 3, progressPercent: 50, createdById: id.coach1, createdByName: "User coach1", checkIns: [] });
    expect((await prisma.goal.findFirst({ where: { id: g1.body.id } }))?.targetSessions).toBe(6); // legacy column kept in step
    id.g1 = g1.body.id;

    const g2 = await post("owner", { title: "10 home workouts", metric: "workouts_completed", targetValue: 10, startsOn: d(-10) });
    expect(g2.status).toBe(201);
    expect(g2.body).toMatchObject({ currentValue: 5, progressPercent: 50 });
    id.g2 = g2.body.id;

    const g3 = await post("coach1", { title: "Green belt", metric: "level", targetLevelId: id.lvlGreen, startsOn: d(-30) });
    expect(g3.status).toBe(201);
    ok(g3.body, "Goal");
    expect(g3.body).toMatchObject({ targetLevelId: id.lvlGreen, targetLevelName: "Green", targetValue: 3, currentValue: 2, progressPercent: 50 });
    id.g3 = g3.body.id;

    const g4 = await post("coach1", { title: "5k run", metric: "custom", startValue: 20, targetValue: 15, unit: "min", targetDate: d(60) });
    expect(g4.status).toBe(201);
    expect(g4.body).toMatchObject({ currentValue: null, progressPercent: 0, unit: "min", startValue: 20, targetValue: 15, targetDate: d(60), startsOn: d(0) });
    id.g4 = g4.body.id;

    // check-ins
    const ci = (who: string, body: unknown, goal = id.g4) => call(addCheckIn, "POST", "", who, { params: { goalId: goal }, body });
    expect((await ci("coach1", {})).status).toBe(400);
    expect((await ci("coach1", { value: "x" })).status).toBe(400);
    expect((await ci("coach1", { value: 1, note: "n".repeat(281) })).status).toBe(400);
    expect((await ci("coach1", { value: 1, recordedOn: d(1) })).status).toBe(400); // future
    expect((await ci("coach1", { value: 1 }, id.g1)).status).toBe(400); // not a custom goal
    expect((await ci("coach2", { value: 18 })).status).toBe(403);
    expect((await ci("ownerB", { value: 18 })).status).toBe(404);
    expect((await ci("coach1", { value: 18 }, "nope")).status).toBe(404);
    const c1 = await ci("coach1", { value: 18, recordedOn: d(-5), note: "first try" });
    expect(c1.status).toBe(201);
    ok(c1.body, "Goal");
    expect(c1.body).toMatchObject({ currentValue: 18, progressPercent: 40 });
    const c2 = await ci("owner", { value: 17.5 });
    expect(c2.body).toMatchObject({ currentValue: 17.5, progressPercent: 50 });
    expect(c2.body.checkIns.map((c: any) => c.value)).toEqual([17.5, 18]); // newest first
    expect(await prisma.goalCheckIn.count({ where: { tenantId: id.A } })).toBe(2);

    // list: newest first, with progress, filter, both customer views
    const list = await get(listGoals, "goals", "cust", "m1");
    expect(list.status).toBe(200);
    expect(list.body.items.map((g: any) => g.id)).toEqual([id.g4, id.g3, id.g2, id.g1]);
    for (const g of list.body.items) ok(g, "Goal");
    expect((await get(listGoals, "goals", "cust", "m1", "?status=achieved")).body.items).toEqual([]);
    expect((await get(listGoals, "goals", "cust", "m1", "?status=bogus")).status).toBe(400);
    expect((await get(listGoals, "goals", "parent", "kid")).body.items).toEqual([]);

    // update: validation, row rules, achieved stays 100, dropped keeps the computed value
    const patch = (who: string, goal: string, body: unknown) => call(patchGoal, "PATCH", "", who, { params: { goalId: goal }, body });
    expect((await patch("coach1", id.g1, {})).status).toBe(400);
    expect((await patch("coach1", id.g1, { status: "done" })).status).toBe(400);
    expect((await patch("coach1", id.g1, { title: "" })).status).toBe(400);
    expect((await patch("coach1", id.g1, { targetValue: 0 })).status).toBe(400);
    expect((await patch("coach1", id.g3, { targetValue: 4 })).status).toBe(400); // level goals have no numeric target
    expect((await patch("coach2", id.g1, { title: "hijack" })).status).toBe(403);
    expect((await patch("ownerB", id.g1, { title: "hijack" })).status).toBe(404);
    expect((await patch("coach1", "nope", { title: "x" })).status).toBe(404);
    const up = await patch("coach1", id.g1, { title: "Attend 4 classes", targetValue: 4 });
    expect(up.status).toBe(200);
    ok(up.body, "Goal");
    expect(up.body).toMatchObject({ title: "Attend 4 classes", targetValue: 4, currentValue: 3, progressPercent: 75 });
    expect((await prisma.goal.findFirst({ where: { id: id.g1 } }))?.targetSessions).toBe(4);
    const done = await patch("coach1", id.g2, { status: "achieved" });
    expect(done.body).toMatchObject({ status: "achieved", progressPercent: 100, currentValue: 5 });
    const dropped = await patch("coach1", id.g3, { status: "dropped" });
    expect(dropped.body).toMatchObject({ status: "dropped", progressPercent: 50 });
    expect((await get(listGoals, "goals", "cust", "m1", "?status=achieved")).body.items.map((g: any) => g.id)).toEqual([id.g2]);
    const reopen = await patch("coach1", id.g3, { status: "active", targetDate: null });
    expect(reopen.body.status).toBe("active");

    // stats goal counts follow status
    const stats = await get(getStats, "stats", "cust", "m1");
    expect(stats.body.goals).toEqual({ active: 3, achieved: 1 });
  });

  it("recordWorkoutLog: validation, scheduled-item and date rules, row access", async (ctx) => {
    if (!prisma) return ctx.skip();
    const bad = async (body: unknown, field: string, who = "cust") => {
      const r = await put(who, body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.body.error.code).toBe("validation_failed");
      expect(JSON.stringify(r.body.error.details)).toContain(field);
    };
    await bad(act("start", { clientId: "short" }), "clientId");
    await bad(act("start", { clientId: "c".repeat(65) }), "clientId");
    await bad(act("dance"), "action");
    await bad(act("start", { scheduledFor: "26-11-2026" }), "scheduledFor");
    await bad(act("start", { assignmentId: "" }), "assignmentId");
    await bad(act("complete", { actualSets: 51 }), "actualSets");
    await bad(act("complete", { actualReps: -1 }), "actualReps");
    await bad(act("complete", { actualDurationSeconds: 14_401 }), "actualDurationSeconds");
    await bad(act("complete", { note: "n".repeat(281) }), "note");
    await bad(act("complete", { occurredAt: "yesterday" }), "occurredAt");
    await bad(act("start", { memberId: id.m2 }), "memberId"); // not the assignment's member
    await bad(act("start", { scheduledFor: d(1) }), "scheduledFor"); // future
    await bad(act("start", { scheduledFor: d(-11) }), "planItemId"); // before the assignment starts
    await bad(act("start", { planItemId: id.foreignItem }), "planItemId"); // not an item of this assignment's plan
    await bad(act("start", { assignmentId: id.asgM3 }), "planItemId", "coach1"); // paused assignment schedules nothing
    const notJson = await (putLog as Handler)(new Request("http://localhost/api/v1/workout-logs", { method: "PUT", headers: { authorization: `Bearer ${tokens.cust}` }, body: "nope" }), { params: Promise.resolve({}) });
    expect(notJson.status).toBe(400);

    // row access
    expect((await put("other", act("start"))).status).toBe(403);
    expect((await put("parent", act("start"))).status).toBe(403);
    expect((await put("coach2", act("start"))).status).toBe(403);
    expect((await put("ownerB", act("start"))).status).toBe(403); // policy: owner role
    expect((await put("cust", act("start", { assignmentId: "nope" }))).status).toBe(404);
    expect(await prisma.workoutLog.count({ where: { tenantId: id.A, scheduledFor: utcDate(d(0)) } })).toBe(0);
  });

  it("recordWorkoutLog: state machine, idempotent replay, clientId conflicts", async (ctx) => {
    if (!prisma) return ctx.skip();
    expect((await put("cust", act("stop"))).status).toBe(409); // never started
    expect(await prisma.workoutLog.count({ where: { tenantId: id.A, scheduledFor: utcDate(d(0)) } })).toBe(0);

    const start = act("start", { occurredAt: new Date(Date.now() - 60_000).toISOString() });
    const s1 = await put("cust", start);
    expect(s1.status).toBe(200);
    ok(s1.body, "WorkoutLog");
    expect(s1.body).toMatchObject({ status: "started", clientId: start.clientId, memberId: id.m1, scheduledFor: d(0), exerciseName: "Front kick", planTitle: "Daily moves", recordedById: id.cust, completedAt: null });
    expect(s1.body.startedAt).toBeTruthy();

    // offline replay of the same request: same row, nothing changes
    const replay = await put("cust", start);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(s1.body);
    expect(await prisma.workoutLog.count({ where: { tenantId: id.A, scheduledFor: utcDate(d(0)) } })).toBe(1);

    // the same clientId may not be reused for another item (or date)
    const clash = await put("cust", { ...start, planItemId: it2 });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe("conflict");
    expect((await put("cust", { ...start, scheduledFor: d(-1) })).status).toBe(409);

    // the same device reuses one clientId for later actions on the same item
    const stop = await put("cust", { ...start, action: "stop" });
    expect(stop.body).toMatchObject({ id: s1.body.id, status: "stopped" });
    const again = await put("cust", act("start"));
    expect(again.body).toMatchObject({ id: s1.body.id, status: "started", startedAt: s1.body.startedAt });
    expect((await put("cust", act("start"))).status).toBe(200); // repeated start is a no-op
    expect((await put("cust", act("skip"))).status).toBe(409); // a started item cannot be skipped

    const completeBody = act("complete", { actualSets: 3, actualReps: 10, note: "felt good" });
    const c = await put("cust", completeBody);
    expect(c.status).toBe(200);
    ok(c.body, "WorkoutLog");
    expect(c.body).toMatchObject({ status: "completed", actualSets: 3, actualReps: 10, note: "felt good", id: s1.body.id });
    expect(c.body.completedAt).toBeTruthy();
    // replay keeps completedAt and the stored values
    const cReplay = await put("cust", completeBody);
    expect(cReplay.status).toBe(200);
    expect(cReplay.body.completedAt).toBe(c.body.completedAt);
    // completed is final
    for (const a of ["start", "stop", "skip"]) expect((await put("cust", act(a))).status, a).toBe(409);
    expect((await prisma.workoutLog.findFirst({ where: { id: s1.body.id } }))?.status).toBe("COMPLETED");

    // skip a fresh item; skip again is idempotent; nothing else is allowed afterwards
    const skip = await put("cust", act("skip", { planItemId: it2 }));
    expect(skip.body.status).toBe("skipped");
    expect((await put("cust", act("skip", { planItemId: it2 }))).status).toBe(200);
    for (const a of ["start", "stop", "complete"]) expect((await put("cust", act(a, { planItemId: it2 }))).status, a).toBe(409);

    // complete straight from nothing, on a past date
    const direct = await put("cust", act("complete", { scheduledFor: d(-6) }));
    expect(direct.body).toMatchObject({ status: "completed", startedAt: null });

    // a coach records for a member they manage; the log keeps who recorded it
    const byCoach = await put("coach1", act("skip", { scheduledFor: d(-7) }));
    expect(byCoach.status).toBe(200);
    expect(byCoach.body).toMatchObject({ status: "skipped", recordedById: id.coach1 });

    // concurrent first writes for the same item converge on one row
    const [x, y] = await Promise.all([put("cust", act("start", { scheduledFor: d(-8) })), put("cust", act("start", { scheduledFor: d(-8) }))]);
    expect([x.status, y.status].sort()).toEqual([200, 200]);
    expect(await prisma.workoutLog.count({ where: { tenantId: id.A, planItemId: it1, scheduledFor: utcDate(d(-8)) } })).toBe(1);

    // the schedule and stats now reflect the logs; today is an active day, so the streak grows
    const sch = await get(getSchedule, "schedule", "cust", "m1", `?from=${d(0)}&to=${d(0)}`);
    expect(sch.body.days[0].items.map((i: any) => [i.exerciseName, i.status])).toEqual([["Front kick", "completed"], ["Plank hold", "skipped"]]);
    expect(sch.body.days[0].items[0].logId).toBe(s1.body.id);
    const stats = await get(getStats, "stats", "cust", "m1");
    expect(stats.body.workouts).toMatchObject({ scheduled: 22, completed: 7, skipped: 4 }); // completed +today item 1 and d-6; skipped +today item 2 and d-7
    expect(stats.body.streaks).toEqual({ currentActiveDays: 5, longestActiveDays: 5 });
    // the "10 home workouts" goal was achieved by the coach: stays 100; the open one moves with the logs
    const goals = await get(listGoals, "goals", "cust", "m1");
    expect(goals.body.items.find((g: any) => g.id === id.g2)).toMatchObject({ currentValue: 7, progressPercent: 100 });
  });

  it("updates feed: coach changes reach the customer, unread count, mark read", async (ctx) => {
    if (!prisma) return ctx.skip();
    const feed = async (who: string, member = "m1", q = "") => {
      const r = await get(listUpdates, "updates", who, member, q);
      expect(r.status).toBe(200);
      ok(r.body, "MemberUpdatePage");
      return r.body;
    };
    const first = await feed("cust");
    // plan_assigned (assignment) + four goals set; later edits add goal_updated
    const kinds = first.items.map((u: any) => u.kind);
    expect(kinds.filter((k: string) => k === "plan_assigned")).toHaveLength(1);
    expect(kinds.filter((k: string) => k === "goal_set")).toHaveLength(4);
    expect(kinds.filter((k: string) => k === "goal_updated").length).toBeGreaterThanOrEqual(3);
    expect(first.unreadCount).toBe(first.items.length);
    expect(first.items.every((u: any) => u.read === false)).toBe(true);
    const created = first.items.map((u: any) => u.createdAt);
    expect([...created].sort().reverse()).toEqual(created); // newest first
    const goalSet = first.items.find((u: any) => u.kind === "goal_set");
    expect(goalSet).toMatchObject({ entityType: "goal", actorName: "User coach1", memberId: id.m1 });
    expect(goalSet.title).toMatch(/^New goal: /);
    expect(typeof goalSet.params.goalTitle).toBe("string");
    // the kid's feed is separate, and a coach plan edit only reaches members holding the plan
    expect((await feed("parent", "kid")).items).toEqual([]);

    // coach edits the plan: plan_updated for the customer, unread +1
    const cur = await call(getPlan as Handler, "GET", "", "coach1", { params: { planId: id.plan } });
    const edit = await call(putPlan, "PUT", "", "coach1", {
      params: { planId: id.plan },
      body: {
        title: "Daily moves v2",
        cadence: "daily",
        expectedVersion: cur.body.version,
        days: [{ dayIndex: 1, title: "Daily", items: cur.body.days[0].items.map((i: any) => ({ id: i.id, exerciseId: i.exerciseId, position: i.position, sets: i.sets, reps: i.reps, durationSeconds: i.durationSeconds })) }],
      },
    });
    expect(edit.status).toBe(200);
    const after = await feed("cust");
    expect(after.unreadCount).toBe(first.unreadCount + 1);
    expect(after.items[0]).toMatchObject({ kind: "plan_updated", read: false, entityType: "plan" });
    expect(after.items[0].params.planTitle).toBe("Daily moves v2");
    expect(after.items[0].title).toBe("Your plan Daily moves v2 was updated");

    // coaches and the owner see the feed (read-only); a goal change from the coach arrives as goal_updated
    expect((await feed("coach1")).unreadCount).toBe(after.unreadCount);
    expect((await feed("owner")).items).toHaveLength(after.items.length);

    // paging
    const p1 = await feed("cust", "m1", "?limit=2");
    expect(p1.items).toHaveLength(2);
    expect(p1.nextCursor).toBeTruthy();
    expect(p1.unreadCount).toBe(after.unreadCount);
    const p2 = await feed("cust", "m1", `?limit=2&cursor=${p1.nextCursor}`);
    expect(p2.items[0].id).toBe(after.items[2].id);
    expect((await get(listUpdates, "updates", "cust", "m1", "?limit=101")).status).toBe(400);

    // mark read: validation, an old cut-off changes nothing, then all-up-to-now clears the badge
    const read = (who: string, body: unknown, member = "m1") => call(markRead, "POST", "", who, { params: m(member), body });
    expect((await read("cust", {})).status).toBe(400);
    expect((await read("cust", { upTo: "yesterday" })).status).toBe(400);
    const none = await read("cust", { upTo: "2000-01-01T00:00:00Z" });
    expect(none.status).toBe(204);
    expect((await feed("cust")).unreadCount).toBe(after.unreadCount);
    // half: mark up to the third newest, the two newest stay unread
    const cut = after.items[2].createdAt;
    expect((await read("cust", { upTo: cut })).status).toBe(204);
    const half = await feed("cust");
    expect(half.items.filter((u: any) => !u.read).length).toBe(half.unreadCount);
    expect(half.unreadCount).toBeLessThanOrEqual(2);
    expect(half.items[half.items.length - 1].read).toBe(true);
    const sch = await get(getSchedule, "schedule", "cust", "m1", `?from=${d(0)}&to=${d(0)}`);
    expect(sch.body.unreadUpdates).toBe(half.unreadCount);

    const all = await read("cust", { upTo: new Date(Date.now() + 60_000).toISOString() });
    expect(all.status).toBe(204);
    expect(all.body).toBeNull();
    const cleared = await feed("cust");
    expect(cleared.unreadCount).toBe(0);
    expect(cleared.items.every((u: any) => u.read)).toBe(true);
    // the coach's view of the feed is unaffected by who reads it, and the kid's rows were untouched
    expect((await prisma.memberUpdate.count({ where: { tenantId: id.A, memberId: id.m1, readAt: null } }))).toBe(0);

    // a new coach action makes it unread again
    const g = await call(createGoal, "POST", "", "coach1", { params: m("m1"), body: { title: "Another", metric: "workouts_completed", targetValue: 20 } });
    expect(g.status).toBe(201);
    const fresh = await feed("cust");
    expect(fresh.unreadCount).toBe(1);
    expect(fresh.items[0]).toMatchObject({ kind: "goal_set", read: false });

    // isolation: rows in another tenant never leak, and ids from there are 404
    expect((await get(listUpdates, "updates", "ownerB", "m1")).status).toBe(404);
    expect(await prisma.memberUpdate.count({ where: { tenantId: id.B } })).toBe(0);
  });
});
