import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { hashToken } from "../lib/auth/tokens";
import { tryConnect } from "./helpers-db";
import { validateSchemaName } from "./contract-schema";
import { GET as listExercises } from "../app/api/v1/exercises/route";
import { GET as getExercise } from "../app/api/v1/exercises/[exerciseId]/route";
import { GET as listPlans, POST as createPlan } from "../app/api/v1/workout-plans/route";
import { GET as getPlan, PUT as putPlan } from "../app/api/v1/workout-plans/[planId]/route";
import { POST as archivePlan } from "../app/api/v1/workout-plans/[planId]/archive/route";
import { GET as listAssignments, POST as createAssignments } from "../app/api/v1/plan-assignments/route";
import { PATCH as patchAssignment } from "../app/api/v1/plan-assignments/[assignmentId]/route";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Handler = (...args: any[]) => Promise<Response>;

const suffix = Date.now().toString(36);

describe("exercises, workout plans and plan assignments (local Postgres, scratch data)", () => {
  let prisma: PrismaClient | null = null;
  const tokens: Record<string, string> = {};
  const sessionIds: string[] = [];
  const tenants: string[] = [];
  const id: Record<string, string> = {};

  async function user(tenantId: string, role: "OWNER" | "COACH" | "CUSTOMER", key: string) {
    return prisma!.user.create({ data: { tenantId, role, email: `${key}-${suffix}@plans.example.test`, name: `User ${key}` } });
  }
  async function login(label: string, u: { id: string; tenantId: string }) {
    const token = `plans-${label}-${Math.random().toString(36).slice(2)}-${Date.now()}`;
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

  beforeAll(async () => {
    prisma = await tryConnect();
    if (!prisma) return;
    const A = (await prisma.tenant.create({ data: { slug: `plans-a-${suffix}`, name: "Plans A" } })).id;
    const B = (await prisma.tenant.create({ data: { slug: `plans-b-${suffix}`, name: "Plans B" } })).id;
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
    Object.assign(id, { owner: owner.id, coach1: coach1.id, coach2: coach2.id });

    const venue = await prisma.venue.create({ data: { tenantId: A, name: "Hall" } });
    const sport = await prisma.sport.create({ data: { tenantId: A, slug: "karate", name: "Karate" } });
    const mkBatch = (coachId: string, name: string) =>
      prisma!.batch.create({
        data: { tenantId: A, venueId: venue.id, sportId: sport.id, coachId, name, daysOfWeek: [1, 3], startTime: "17:00", endTime: "18:00" },
      });
    const b1 = await mkBatch(coach1.id, "Coach1 batch");
    const b2 = await mkBatch(coach2.id, "Coach2 batch");

    const guardian = await prisma.guardian.create({ data: { tenantId: A, userId: parent.id, name: "Parent Guardian" } });
    const mkMember = (displayName: string, extra: object = {}) => prisma!.member.create({ data: { tenantId: A, displayName, ...extra } });
    const m1 = await mkMember("Adult One", { userId: cust.id });
    const kid = await mkMember("Kid One", { isMinor: true, guardianId: guardian.id });
    const m2 = await mkMember("Member Two");
    const m3 = await mkMember("Member Three");
    const left = await mkMember("Member Left");
    const stranger = await mkMember("Stranger", { userId: other.id });
    Object.assign(id, { m1: m1.id, kid: kid.id, m2: m2.id, m3: m3.id, left: left.id, stranger: stranger.id });
    for (const [batchId, memberId, leftOn] of [
      [b1.id, m1.id, null],
      [b1.id, kid.id, null],
      [b1.id, m3.id, null],
      [b2.id, m2.id, null],
      [b1.id, left.id, new Date("2026-01-01T00:00:00Z")],
    ] as const) {
      await prisma.batchMember.create({ data: { tenantId: A, batchId, memberId, leftOn } });
    }
    const mkEx = (tenantId: string, name: string, sourceId: string, extra: object = {}) =>
      prisma!.exercise.create({
        data: {
          tenantId,
          source: "ORIGINAL",
          sourceId,
          sportSlug: "karate",
          name,
          licence: "Original (project)",
          primaryMuscles: ["quadriceps"],
          instructions: ["Step one"],
          ...extra,
        },
      });
    id.ex1 = (await mkEx(A, "Front kick", "fk")).id;
    id.ex2 = (await mkEx(A, "Plank hold", "ph", { sportSlug: "general", primaryMuscles: ["abdominals"], equipment: "body only" })).id;
    id.ex3 = (await mkEx(A, "Squat", "sq", { sportSlug: "general", primaryMuscles: ["quadriceps"] })).id;
    id.exB = (await mkEx(B, "Foreign lunge", "fl")).id;

    await login("owner", owner);
    await login("coach1", coach1);
    await login("coach2", coach2);
    await login("cust", cust);
    await login("parent", parent);
    await login("other", other);
    await login("ownerB", ownerB);
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.authSession.deleteMany({ where: { id: { in: sessionIds } } });
    for (const t of tenants) {
      await prisma.workoutLog.deleteMany({ where: { tenantId: t } });
      await prisma.planAssignment.deleteMany({ where: { tenantId: t } });
      await prisma.workoutPlan.deleteMany({ where: { tenantId: t } });
      await prisma.batch.deleteMany({ where: { tenantId: t } });
      await prisma.tenant.delete({ where: { id: t } });
    }
    await prisma.$disconnect();
  });

  async function call(handler: Handler, method: string, path: string, who?: string, opts: { body?: unknown; params?: Record<string, string> } = {}) {
    const headers: Record<string, string> = who ? { authorization: `Bearer ${tokens[who]}` } : {};
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    const req = new Request(`http://localhost/api/v1${path}`, {
      method,
      headers,
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
    const res = await handler(req, { params: Promise.resolve(opts.params ?? {}) });
    return { status: res.status, body: (await res.json()) as any };
  }

  const weekly = (exA: string, exB: string, extra: object = {}) => ({
    title: "Home circuit",
    cadence: "weekly",
    sportSlug: "karate",
    days: [
      { dayIndex: 1, title: "Legs", items: [{ exerciseId: exA, position: 1, sets: 3, reps: 10 }, { exerciseId: exB, position: 2, durationSeconds: 45 }] },
      { dayIndex: 3, items: [{ exerciseId: exA, position: 1, reps: 20, notes: "slow" }] },
    ],
    ...extra,
  });
  const ok = (body: unknown, schema: string) => expect(validateSchemaName(body, schema)).toEqual([]);
  const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

  it("requires a session and keeps customers off the plan builder", async (ctx) => {
    if (!prisma) return ctx.skip();
    expect((await call(listExercises, "GET", "/exercises")).status).toBe(401);
    expect((await call(listPlans, "GET", "/workout-plans", "cust")).status).toBe(403);
    expect((await call(createPlan, "POST", "/workout-plans", "cust", { body: weekly(id.ex1, id.ex2) })).status).toBe(403);
    expect((await call(listAssignments, "GET", "/plan-assignments")).status).toBe(401);
    expect((await call(createAssignments, "POST", "/plan-assignments", "cust", { body: {} })).status).toBe(403);
  });

  it("exercises: any role, filters, paging, contract, tenant isolation", async (ctx) => {
    if (!prisma) return ctx.skip();
    for (const who of ["owner", "coach1", "cust"]) {
      const r = await call(listExercises, "GET", "/exercises", who);
      expect(r.status).toBe(200);
      ok(r.body, "ExercisePage");
      expect(r.body.items.map((e: any) => e.name)).toEqual(["Front kick", "Plank hold", "Squat"]); // tenant B's exercise is absent
    }
    expect((await call(listExercises, "GET", "/exercises?q=SQU", "coach1")).body.items).toHaveLength(1);
    expect((await call(listExercises, "GET", "/exercises?sport=general", "coach1")).body.items).toHaveLength(2);
    expect((await call(listExercises, "GET", "/exercises?muscle=abdominals", "coach1")).body.items[0].name).toBe("Plank hold");
    expect((await call(listExercises, "GET", "/exercises?equipment=BODY%20ONLY", "coach1")).body.items).toHaveLength(1);
    const p1 = await call(listExercises, "GET", "/exercises?limit=2", "coach1");
    expect(p1.body.items).toHaveLength(2);
    expect(p1.body.nextCursor).toBeTruthy();
    const p2 = await call(listExercises, "GET", `/exercises?limit=2&cursor=${p1.body.nextCursor}`, "coach1");
    expect(p2.body.items.map((e: any) => e.name)).toEqual(["Squat"]);
    expect((await call(listExercises, "GET", "/exercises?limit=0", "coach1")).status).toBe(400);

    const one = await call(getExercise, "GET", `/exercises/${id.ex1}`, "cust", { params: { exerciseId: id.ex1 } });
    expect(one.status).toBe(200);
    ok(one.body, "Exercise");
    const foreign = await call(getExercise, "GET", `/exercises/${id.exB}`, "owner", { params: { exerciseId: id.exB } });
    expect(foreign.status).toBe(404);
  });

  it("createWorkoutPlan: validates the body per the contract", async (ctx) => {
    if (!prisma) return ctx.skip();
    const bad = async (body: unknown, field: string) => {
      const r = await call(createPlan, "POST", "/workout-plans", "coach1", { body });
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.body.error.code).toBe("validation_failed");
      expect(JSON.stringify(r.body.error.details)).toContain(field);
    };
    const item = (extra: object) => ({ exerciseId: id.ex1, position: 1, reps: 5, ...extra });
    await bad({ ...weekly(id.ex1, id.ex2), title: "" }, "title");
    await bad({ ...weekly(id.ex1, id.ex2), cadence: "yearly" }, "cadence");
    await bad({ ...weekly(id.ex1, id.ex2), days: [] }, "days");
    await bad({ title: "x", cadence: "daily", days: [{ dayIndex: 2, items: [item({})] }] }, "days[0].dayIndex");
    await bad({ title: "x", cadence: "weekly", days: [{ dayIndex: 8, items: [item({})] }] }, "days[0].dayIndex");
    await bad({ title: "x", cadence: "weekly", days: [{ dayIndex: 1, items: [] }, { dayIndex: 1, items: [] }] }, "Duplicate day");
    await bad({ title: "x", cadence: "weekly", days: [{ dayIndex: 1, items: [{ exerciseId: id.ex1, position: 1 }] }] }, "reps or durationSeconds");
    await bad({ title: "x", cadence: "weekly", days: [{ dayIndex: 1, items: [item({ sets: 21 })] }] }, "sets");
    await bad({ title: "x", cadence: "weekly", days: [{ dayIndex: 1, items: [item({ restSeconds: 901 })] }] }, "restSeconds");
    await bad({ title: "x", cadence: "weekly", days: [{ dayIndex: 1, items: [item({ position: 0 })] }] }, "position");
    await bad({ title: "x", cadence: "weekly", days: [{ dayIndex: 1, items: [item({ notes: "n".repeat(281) })] }] }, "notes");
    await bad({ title: "x", cadence: "weekly", status: "archived", days: [{ dayIndex: 1, items: [item({})] }] }, "status");
    // Item with another tenant's exercise is rejected with 400 and nothing is written.
    await bad({ title: "x", cadence: "weekly", days: [{ dayIndex: 1, items: [item({ exerciseId: id.exB })] }] }, "days[0].items[0].exerciseId");
    expect(await prisma!.workoutPlan.count({ where: { tenantId: id.A, title: "x" } })).toBe(0);
    const notJson = await (createPlan as Handler)(new Request("http://localhost/api/v1/workout-plans", { method: "POST", headers: { authorization: `Bearer ${tokens.coach1}` }, body: "nope" }), { params: Promise.resolve({}) });
    expect(notJson.status).toBe(400);
  });

  it("create, get, list: coach own plans only, owner all, creator is the caller", async (ctx) => {
    if (!prisma) return ctx.skip();
    const c = await call(createPlan, "POST", "/workout-plans", "coach1", { body: weekly(id.ex1, id.ex2) });
    expect(c.status).toBe(201);
    ok(c.body, "WorkoutPlan");
    expect(c.body.coachId).toBe(id.coach1);
    expect(c.body.version).toBe(1);
    expect(c.body.status).toBe("active");
    expect(c.body.days.map((d: any) => d.dayIndex)).toEqual([1, 3]);
    expect(c.body.days[0].items[1].exerciseName).toBe("Plank hold");
    id.plan1 = c.body.id;

    const o = await call(createPlan, "POST", "/workout-plans", "owner", { body: { ...weekly(id.ex1, id.ex2), title: "Owner plan", status: "draft" } });
    expect(o.status).toBe(201);
    expect(o.body.coachId).toBe(id.owner);
    expect(o.body.status).toBe("draft");
    id.planOwner = o.body.id;

    const c2 = await call(createPlan, "POST", "/workout-plans", "coach2", { body: { ...weekly(id.ex3, id.ex2), title: "Coach2 plan" } });
    id.plan2 = c2.body.id;

    const l1 = await call(listPlans, "GET", "/workout-plans", "coach1");
    expect(l1.status).toBe(200);
    ok(l1.body, "WorkoutPlanPage");
    expect(l1.body.items.map((p: any) => p.id)).toEqual([id.plan1]);
    expect(l1.body.items[0].itemCount).toBe(3);
    expect(l1.body.items[0].dayCount).toBe(2);
    const lo = await call(listPlans, "GET", "/workout-plans", "owner");
    expect(lo.body.items.map((p: any) => p.id).sort()).toEqual([id.plan1, id.planOwner, id.plan2].sort());
    expect((await call(listPlans, "GET", "/workout-plans?status=draft", "owner")).body.items).toHaveLength(1);
    expect((await call(listPlans, "GET", "/workout-plans?q=coach2", "owner")).body.items).toHaveLength(1);
    expect((await call(listPlans, "GET", "/workout-plans?status=bogus", "owner")).status).toBe(400);
    expect((await call(listPlans, "GET", "/workout-plans", "ownerB")).body.items).toEqual([]);

    const get = (who: string, planId: string) => call(getPlan, "GET", `/workout-plans/${planId}`, who, { params: { planId } });
    expect((await get("coach1", id.plan1)).status).toBe(200);
    expect((await get("coach2", id.plan1)).status).toBe(403); // not their plan, no assigned member of theirs
    expect((await get("owner", id.plan1)).status).toBe(200);
    expect((await get("ownerB", id.plan1)).status).toBe(404); // other tenant
    expect((await get("cust", id.plan1)).status).toBe(403); // not assigned
    expect((await get("coach1", "does-not-exist")).status).toBe(404);
  });

  it("createPlanAssignments: row rules, tenant isolation, conflict, all-or-nothing, change feed", async (ctx) => {
    if (!prisma) return ctx.skip();
    const post = (who: string, body: unknown) => call(createAssignments, "POST", "/plan-assignments", who, { body });
    const base = { planId: id.plan1, memberIds: [id.m1], startsOn: "2026-11-23" };

    // validation
    expect((await post("coach1", { ...base, memberIds: [] })).status).toBe(400);
    expect((await post("coach1", { ...base, startsOn: "23/11/2026" })).status).toBe(400);
    expect((await post("coach1", { ...base, startsOn: "2026-02-30" })).status).toBe(400);
    expect((await post("coach1", { ...base, endsOn: "2026-11-01" })).status).toBe(400);
    expect((await post("coach1", { ...base, note: "n".repeat(281) })).status).toBe(400);
    expect((await post("coach1", { ...base, planId: undefined })).status).toBe(400);
    // row rules
    expect((await post("coach1", { ...base, memberIds: [id.m2] })).status).toBe(403); // another coach's member
    expect((await post("coach1", { ...base, memberIds: [id.m1, id.m2] })).status).toBe(403); // one bad member sinks the call
    expect((await post("coach1", { ...base, memberIds: [id.left] })).status).toBe(403); // left the batch
    expect((await post("coach1", { ...base, memberIds: [id.stranger] })).status).toBe(403); // in no batch
    expect((await post("coach2", { ...base, memberIds: [id.m2] })).status).toBe(403); // not their plan
    expect((await post("coach1", { ...base, planId: id.planOwner })).status).toBe(403); // owner's plan
    expect((await post("ownerB", base)).status).toBe(404); // other tenant plan
    expect((await post("owner", { ...base, memberIds: ["nope"] })).status).toBe(404);
    expect((await post("coach1", { ...base, planId: id.planOwner })).status).toBe(403);
    expect((await post("owner", { ...base, planId: id.planOwner })).status).toBe(409); // draft plans cannot be assigned
    expect(await prisma!.planAssignment.count({ where: { tenantId: id.A } })).toBe(0);

    const made = await post("coach1", { ...base, memberIds: [id.m1, id.kid], endsOn: "2026-12-31", note: "Do it after class" });
    expect(made.status).toBe(201);
    expect(made.body.items).toHaveLength(2);
    for (const a of made.body.items) {
      ok(a, "PlanAssignment");
      expect(a.status).toBe("active");
      expect(a.assignedById).toBe(id.coach1);
      expect(a.planVersion).toBe(1);
    }
    id.asgM1 = made.body.items.find((a: any) => a.memberId === id.m1).id;
    id.asgKid = made.body.items.find((a: any) => a.memberId === id.kid).id;

    const feed = await prisma!.memberUpdate.findMany({ where: { tenantId: id.A, kind: "PLAN_ASSIGNED" } });
    expect(feed.map((f) => f.memberId).sort()).toEqual([id.m1, id.kid].sort());
    expect(feed[0].actorId).toBe(id.coach1);
    expect(feed[0].params).toMatchObject({ planTitle: "Home circuit" });

    // duplicate active assignment, even mixed with a new member, is 409 and writes nothing
    const before = await prisma!.planAssignment.count({ where: { tenantId: id.A } });
    const dup = await post("coach1", { ...base, memberIds: [id.m3, id.m1] });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("conflict");
    expect(await prisma!.planAssignment.count({ where: { tenantId: id.A } })).toBe(before);
    expect(await prisma!.memberUpdate.count({ where: { tenantId: id.A, kind: "PLAN_ASSIGNED" } })).toBe(2);

    // the owner can assign anyone in the tenant, including a coach's plan
    const ownerMade = await post("owner", { planId: id.plan1, memberIds: [id.m2], startsOn: "2026-11-23" });
    expect(ownerMade.status).toBe(201);
    id.asgM2 = ownerMade.body.items[0].id;
  });

  it("getWorkoutPlan: customer and coach visibility follow assignments", async (ctx) => {
    if (!prisma) return ctx.skip();
    const get = (who: string, planId: string) => call(getPlan, "GET", `/workout-plans/${planId}`, who, { params: { planId } });
    expect((await get("cust", id.plan1)).status).toBe(200); // assigned to self
    expect((await get("parent", id.plan1)).status).toBe(200); // assigned to child
    expect((await get("other", id.plan1)).status).toBe(403);
    expect((await get("cust", id.plan2)).status).toBe(403);
    // coach2 manages m2, who holds plan1 through the owner's assignment, so the plan is readable but not editable
    expect((await get("coach2", id.plan1)).status).toBe(200);
    const put = await call(putPlan, "PUT", "", "coach2", { params: { planId: id.plan1 }, body: { ...weekly(id.ex1, id.ex2), expectedVersion: 1 } });
    expect(put.status).toBe(403);
  });

  it("listPlanAssignments: scoped per role, filters, adherence", async (ctx) => {
    if (!prisma) return ctx.skip();
    const list = (who: string, q = "") => call(listAssignments, "GET", `/plan-assignments${q}`, who);
    const owner = await list("owner");
    expect(owner.status).toBe(200);
    ok(owner.body, "PlanAssignmentPage");
    expect(owner.body.items).toHaveLength(3);
    expect((await list("coach1")).body.items.map((a: any) => a.memberId).sort()).toEqual([id.m1, id.kid, id.m2].sort()); // own plan covers all three
    expect((await list("coach2")).body.items.map((a: any) => a.memberId)).toEqual([id.m2]);
    expect((await list("cust")).body.items.map((a: any) => a.memberId)).toEqual([id.m1]);
    expect((await list("parent")).body.items.map((a: any) => a.memberId)).toEqual([id.kid]);
    expect((await list("other")).body.items).toEqual([]);
    expect((await list("ownerB")).body.items).toEqual([]);
    expect((await list("cust", `?memberId=${id.kid}`)).body.items).toEqual([]); // cannot widen the filter
    expect((await list("owner", `?memberId=${id.m1}`)).body.items).toHaveLength(1);
    expect((await list("owner", `?planId=${id.plan1}&status=active`)).body.items).toHaveLength(3);
    expect((await list("owner", "?status=ended")).body.items).toHaveLength(0);
    expect((await list("owner", "?status=nope")).status).toBe(400);
    const paged = await list("owner", "?limit=2");
    expect(paged.body.items).toHaveLength(2);
    expect((await list("owner", `?limit=2&cursor=${paged.body.nextCursor}`)).body.items).toHaveLength(1);

    // adherence: a daily plan with two items starting today; one completed log gives 50
    const daily = await call(createPlan, "POST", "/workout-plans", "coach1", {
      body: { title: "Daily", cadence: "daily", days: [{ dayIndex: 1, items: [{ exerciseId: id.ex1, position: 1, reps: 5 }, { exerciseId: id.ex2, position: 2, durationSeconds: 30 }] }] },
    });
    const a = await call(createAssignments, "POST", "/plan-assignments", "coach1", { body: { planId: daily.body.id, memberIds: [id.m3], startsOn: today() } });
    expect(a.body.items[0].adherencePercent).toBe(0);
    const itemId = daily.body.days[0].items[0].id;
    await prisma!.workoutLog.create({
      data: {
        tenantId: id.A,
        assignmentId: a.body.items[0].id,
        planItemId: itemId,
        memberId: id.m3,
        scheduledFor: new Date(`${today()}T00:00:00Z`),
        status: "COMPLETED",
        clientId: `c-${suffix}`,
        recordedById: id.coach1,
      },
    });
    const again = await list("coach1", `?memberId=${id.m3}`);
    expect(again.body.items[0].adherencePercent).toBe(50);
    ok(again.body, "PlanAssignmentPage");
  });

  it("updateWorkoutPlan: version check, in-place edit, archives logged items, notifies assignees", async (ctx) => {
    if (!prisma) return ctx.skip();
    const put = (who: string, planId: string, body: unknown) => call(putPlan, "PUT", "", who, { params: { planId }, body });
    const current = (await call(getPlan, "GET", "", "coach1", { params: { planId: id.plan1 } })).body;
    const keepItem = current.days[0].items[0];
    const loggedItem = current.days[0].items[1];
    const dayThreeItem = current.days[1].items[0];

    expect((await put("coach1", id.plan1, weekly(id.ex1, id.ex2))).status).toBe(400); // expectedVersion missing
    const stale = await put("coach1", id.plan1, { ...weekly(id.ex1, id.ex2), expectedVersion: 5 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("conflict");
    expect((await put("ownerB", id.plan1, { ...weekly(id.ex1, id.ex2), expectedVersion: 1 })).status).toBe(404);
    expect((await put("cust", id.plan1, { ...weekly(id.ex1, id.ex2), expectedVersion: 1 })).status).toBe(403);
    expect((await put("coach1", id.plan1, { ...weekly(id.exB, id.ex2), expectedVersion: 1 })).status).toBe(400);

    // log the second item of day 1 for an assignment, then drop it from the plan
    await prisma!.workoutLog.create({
      data: {
        tenantId: id.A,
        assignmentId: id.asgM1,
        planItemId: loggedItem.id,
        memberId: id.m1,
        scheduledFor: new Date("2026-11-23T00:00:00Z"),
        status: "COMPLETED",
        clientId: `c2-${suffix}`,
        recordedById: id.coach1,
      },
    });
    const updated = await put("coach1", id.plan1, {
      title: "Home circuit v2",
      cadence: "weekly",
      sportSlug: "karate",
      expectedVersion: 1,
      days: [
        { dayIndex: 1, title: "Legs", items: [{ id: keepItem.id, exerciseId: id.ex1, position: 1, sets: 4, reps: 12 }] }, // kept, edited, loggedItem dropped
        { dayIndex: 5, items: [{ exerciseId: id.ex3, position: 1, reps: 8 }] }, // new day; day 3 removed
      ],
    });
    expect(updated.status).toBe(200);
    ok(updated.body, "WorkoutPlan");
    expect(updated.body.version).toBe(2);
    expect(updated.body.title).toBe("Home circuit v2");
    expect(updated.body.days.map((d: any) => d.dayIndex)).toEqual([1, 5]);
    expect(updated.body.days[0].items).toHaveLength(1);
    expect(updated.body.days[0].items[0]).toMatchObject({ id: keepItem.id, sets: 4, reps: 12 }); // same row, so its logs stay attached

    const archived = await prisma!.workoutPlanItem.findUnique({ where: { id: loggedItem.id } });
    expect(archived?.archivedAt).not.toBeNull(); // kept for history
    expect(await prisma!.workoutPlanItem.findUnique({ where: { id: dayThreeItem.id } })).toBeNull(); // no logs: removed
    expect(await prisma!.workoutLog.count({ where: { planItemId: loggedItem.id } })).toBe(1);

    const feed = await prisma!.memberUpdate.findMany({ where: { tenantId: id.A, kind: "PLAN_UPDATED", entityId: id.plan1 } });
    expect(feed.map((f) => f.memberId).sort()).toEqual([id.m1, id.kid, id.m2].sort());
    expect((await prisma!.planAssignment.findMany({ where: { planId: id.plan1 } })).every((a) => a.planVersion === 2)).toBe(true);

    // the previous version is now stale
    expect((await put("coach1", id.plan1, { ...weekly(id.ex1, id.ex2), expectedVersion: 1 })).status).toBe(409);
    // the activeAssignmentCount on the plan
    expect(updated.body.activeAssignmentCount).toBe(3);
  });

  it("updatePlanAssignment: pause, resume, end, dates; role and tenant rules", async (ctx) => {
    if (!prisma) return ctx.skip();
    const patch = (who: string, assignmentId: string, body: unknown) => call(patchAssignment, "PATCH", "", who, { params: { assignmentId }, body });
    expect((await patch("cust", id.asgM1, { status: "paused" })).status).toBe(403);
    expect((await patch("ownerB", id.asgM1, { status: "paused" })).status).toBe(404);
    expect((await patch("coach2", id.asgM1, { status: "paused" })).status).toBe(403); // not their member
    expect((await patch("coach1", id.asgM2, { status: "paused" })).status).toBe(403); // coach1's plan, but m2 belongs to coach2
    expect((await patch("coach1", id.asgM1, {})).status).toBe(400);
    expect((await patch("coach1", id.asgM1, { status: "bogus" })).status).toBe(400);
    expect((await patch("coach1", id.asgM1, { endsOn: "2026-01-01" })).status).toBe(400);

    const paused = await patch("coach1", id.asgM1, { status: "paused" });
    expect(paused.status).toBe(200);
    ok(paused.body, "PlanAssignment");
    expect(paused.body.status).toBe("paused");
    expect(paused.body.adherencePercent).toBeNull();
    const resumed = await patch("coach1", id.asgM1, { status: "active", endsOn: "2027-01-15", note: null });
    expect(resumed.body).toMatchObject({ status: "active", endsOn: "2027-01-15", note: null });

    const ended = await patch("coach1", id.asgM1, { status: "ended" });
    expect(ended.status).toBe(200);
    expect(ended.body.status).toBe("ended");
    expect(ended.body.endsOn).toBe(today() > "2026-11-23" ? today() : "2026-11-23"); // never before startsOn
    ok(ended.body, "PlanAssignment");
    expect((await patch("coach1", id.asgM1, { status: "active" })).status).toBe(409); // ended is final

    const feed = await prisma!.memberUpdate.findMany({ where: { tenantId: id.A, memberId: id.m1, entityId: id.asgM1 }, orderBy: { createdAt: "asc" } });
    expect(feed.map((f) => f.kind)).toEqual(["PLAN_ASSIGNED", "PLAN_UPDATED", "PLAN_UPDATED", "PLAN_ENDED"]);

    // owner may change any assignment
    const ownerPatch = await patch("owner", id.asgM2, { startsOn: "2026-11-24" });
    expect(ownerPatch.status).toBe(200);
    expect(ownerPatch.body.startsOn).toBe("2026-11-24");
    // after being ended the member can be assigned the same plan again
    const again = await call(createAssignments, "POST", "/plan-assignments", "coach1", { body: { planId: id.plan1, memberIds: [id.m1], startsOn: today() } });
    expect(again.status).toBe(201);
    id.asgM1b = again.body.items[0].id;
  });

  it("archiveWorkoutPlan: own plans only, ends assignments, notifies, then blocks edits and new assignments", async (ctx) => {
    if (!prisma) return ctx.skip();
    const arch = (who: string, planId: string) => call(archivePlan, "POST", "", who, { params: { planId } });
    expect((await arch("coach2", id.plan1)).status).toBe(403);
    expect((await arch("cust", id.plan1)).status).toBe(403);
    expect((await arch("ownerB", id.plan1)).status).toBe(404);

    const r = await arch("coach1", id.plan1);
    expect(r.status).toBe(200);
    ok(r.body, "WorkoutPlan");
    expect(r.body.status).toBe("archived");
    expect(r.body.activeAssignmentCount).toBe(0);
    const rows = await prisma!.planAssignment.findMany({ where: { planId: id.plan1 } });
    expect(rows.every((a) => a.status === "ENDED" && a.endsOn !== null)).toBe(true);
    const ended = await prisma!.memberUpdate.findMany({ where: { tenantId: id.A, kind: "PLAN_ENDED" } });
    expect(ended.map((e) => e.memberId)).toEqual(expect.arrayContaining([id.kid, id.m2, id.m1]));
    const count = ended.length;

    expect((await arch("coach1", id.plan1)).status).toBe(200); // idempotent, no extra feed rows
    expect(await prisma!.memberUpdate.count({ where: { tenantId: id.A, kind: "PLAN_ENDED" } })).toBe(count);
    expect((await call(putPlan, "PUT", "", "coach1", { params: { planId: id.plan1 }, body: { ...weekly(id.ex1, id.ex2), expectedVersion: 2 } })).status).toBe(409);
    expect((await call(createAssignments, "POST", "/plan-assignments", "coach1", { body: { planId: id.plan1, memberIds: [id.m3], startsOn: today() } })).status).toBe(409);
    expect((await call(listPlans, "GET", "/workout-plans?status=archived", "coach1")).body.items).toHaveLength(1);
    // customers can still open an archived plan they were assigned (history)
    expect((await call(getPlan, "GET", "", "cust", { params: { planId: id.plan1 } })).status).toBe(200);
  });
});
