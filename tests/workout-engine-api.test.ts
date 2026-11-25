/**
 * STAR-107: workout engine API. Real route handlers, real sessions, two isolated fake tenants
 * (tests/helpers-api.ts). The role matrix and tenant isolation of every new operation live in
 * api-matrix.test.ts; this file covers behaviour: idempotency, derived totals, records, supersets,
 * class workouts and summaries, share links, skills, bulk send, results and class insights.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { tryConnect } from "./helpers-db";
import { validateSchemaName } from "./contract-schema";
import { buildWorld, call, d, uniq, type Handler, type World } from "./helpers-api";
import { hashToken } from "../lib/auth/tokens";
import { getSharedClassSummary, SHARE_TTL_MS } from "../lib/api/class-summary";
import { PUT as putSets } from "../app/api/v1/workout-sets/route";
import { PUT as putLog } from "../app/api/v1/workout-logs/route";
import { GET as listSets } from "../app/api/v1/members/[memberId]/workout-sets/route";
import { GET as history } from "../app/api/v1/members/[memberId]/exercises/[exerciseId]/history/route";
import { POST as createPlan } from "../app/api/v1/workout-plans/route";
import { PUT as updatePlan, GET as getPlan } from "../app/api/v1/workout-plans/[planId]/route";
import { POST as createAssignments } from "../app/api/v1/plan-assignments/route";
import { GET as getSchedule } from "../app/api/v1/members/[memberId]/schedule/route";
import { PUT as attachWorkout, GET as getWorkout } from "../app/api/v1/sessions/[sessionId]/workout/route";
import { PUT as putAttendance } from "../app/api/v1/sessions/[sessionId]/attendance/route";
import { GET as getSummary, POST as publishSummary } from "../app/api/v1/sessions/[sessionId]/summary/route";
import { POST as createShare } from "../app/api/v1/sessions/[sessionId]/summary/shares/route";
import { GET as publicSummary } from "../app/api/v1/public/class-summaries/[token]/route";
import { GET as memberSummaries } from "../app/api/v1/members/[memberId]/class-summaries/route";
import { GET as listUpdates } from "../app/api/v1/members/[memberId]/updates/route";
import { GET as listChecklists } from "../app/api/v1/skill-checklists/route";
import { GET as skillProgress } from "../app/api/v1/members/[memberId]/skill-progress/route";
import { PUT as signOff, DELETE as clearSignOff } from "../app/api/v1/members/[memberId]/skill-sign-offs/[skillItemId]/route";
import { POST as bulkSend } from "../app/api/v1/plan-assignments/bulk/route";
import { GET as planResults } from "../app/api/v1/workout-plans/[planId]/results/route";
import { GET as insights } from "../app/api/v1/analytics/classes/route";

/* eslint-disable @typescript-eslint/no-explicit-any */
const sha = hashToken;

describe("workout engine API (local Postgres)", () => {
  let prisma: PrismaClient | null = null;
  let w: World;
  const A = () => w.A;
  const B = () => w.B;
  const x: Record<string, any> = {};

  const put = (h: Handler, path: string, token: string | undefined, body: unknown, params: Record<string, string> = {}) => call(h, "PUT", path, token, { body, params });
  const post = (h: Handler, path: string, token: string | undefined, body: unknown, params: Record<string, string> = {}) => call(h, "POST", path, token, { body, params });
  const get = (h: Handler, path: string, token: string | undefined, params: Record<string, string> = {}) => call(h, "GET", path, token, { params });

  const setsBody = (date: string, sets: any[], extra: Record<string, unknown> = {}, item = A().ids.planItem) => ({
    clientId: `log-${uniq()}`,
    assignmentId: A().ids.assignment,
    planItemId: item,
    scheduledFor: date,
    sets,
    ...extra,
  });
  const aSet = (setNumber: number, extra: Record<string, unknown> = {}) => ({ clientId: `set-${uniq()}`, setNumber, weightKg: 40, reps: 8, ...extra });

  beforeAll(async () => {
    prisma = await tryConnect();
    if (!prisma) return;
    w = await buildWorld(prisma, "qa107");
  });
  afterAll(async () => {
    if (!prisma) return;
    await w?.cleanup();
    await prisma.$disconnect();
  });

  // ---------------------------------------------------------------- per-set logging

  describe("recordWorkoutSets, listWorkoutSets, getExerciseHistory", () => {
    it("logs sets for an assigned item: creates the log, derives totals (warm-ups not counted), matches the contract", async (ctx) => {
      if (!prisma) return ctx.skip();
      const body = setsBody(d(-2), [aSet(1, { setType: "warmup", weightKg: 20, reps: 10 }), aSet(2), aSet(3)]);
      x.firstBody = body;
      const r = await put(putSets, "/workout-sets", A().token.parent, body);
      expect(r.status, r.text).toBe(200);
      expect(validateSchemaName(r.body, "WorkoutLogWithSets")).toEqual([]);
      expect(r.body.status).toBe("started");
      expect(r.body.actualSets).toBe(2);
      expect(r.body.actualReps).toBe(16);
      expect(r.body.sets.map((s: any) => [s.setNumber, s.setType])).toEqual([[1, "warmup"], [2, "normal"], [3, "normal"]]);
      expect(r.body.newBests).toEqual([]); // first session is a baseline
      x.log1 = r.body.id;
    });

    it("is idempotent by clientId: replaying the same request changes nothing, an edited set is updated in place", async (ctx) => {
      if (!prisma) return ctx.skip();
      const again = await put(putSets, "/workout-sets", A().token.parent, x.firstBody);
      expect(again.status, again.text).toBe(200);
      expect(again.body.id).toBe(x.log1);
      expect(await prisma.workoutSet.count({ where: { logId: x.log1 } })).toBe(3);
      const edited = { ...x.firstBody, sets: x.firstBody.sets.map((s: any) => (s.setNumber === 3 ? { ...s, reps: 6 } : s)) };
      const r = await put(putSets, "/workout-sets", A().token.parent, edited);
      expect(r.status).toBe(200);
      expect(r.body.sets.find((s: any) => s.setNumber === 3).reps).toBe(6);
      expect(r.body.actualReps).toBe(14);
      expect(await prisma.workoutSet.count({ where: { logId: x.log1 } })).toBe(3);
      expect(await prisma.workoutLog.count({ where: { tenantId: A().id, clientId: x.firstBody.clientId } })).toBe(1);
    });

    it("complete moves the item to completed with the member's note; the item-level flow keeps working and cannot overwrite derived totals", async (ctx) => {
      if (!prisma) return ctx.skip();
      const r = await put(putSets, "/workout-sets", A().token.parent, { ...x.firstBody, complete: true, note: "Felt strong" });
      expect(r.status, r.text).toBe(200);
      expect(r.body.status).toBe("completed");
      expect(r.body.note).toBe("Felt strong");
      expect(r.body.completedAt).toBeTruthy();
      // The existing item-level action on the same log still answers, and the derived totals stay.
      const same = await put(putLog, "/workout-logs", A().token.parent, { clientId: `old-${uniq()}`, assignmentId: A().ids.assignment, planItemId: A().ids.planItem, scheduledFor: d(-2), action: "complete", actualSets: 9, actualReps: 99 });
      expect(same.status, same.text).toBe(200);
      expect(same.body.actualSets).toBe(2);
      expect(same.body.actualReps).toBe(16); // the complete call replayed the original sets (8 reps on set 3)
      // A log without sets still takes item-level actuals as before.
      const plain = await put(putLog, "/workout-logs", A().token.parent, { clientId: `old-${uniq()}`, assignmentId: A().ids.assignment, planItemId: w.A.ids.planItem, scheduledFor: d(-3), action: "complete", actualSets: 3, actualReps: 30 });
      expect(plain.status, plain.text).toBe(200);
      expect(plain.body.actualSets).toBe(3);
    });

    it("reports the records a later session broke, and the history shows sessions, series and records", async (ctx) => {
      if (!prisma) return ctx.skip();
      const r = await put(putSets, "/workout-sets", A().token.parent, setsBody(d(-1), [aSet(1, { weightKg: 45, reps: 8 }), aSet(2, { weightKg: 45, reps: 6 })], { complete: true }));
      expect(r.status, r.text).toBe(200);
      const heaviest = r.body.newBests.find((n: any) => n.metric === "heaviest_weight");
      expect(heaviest).toMatchObject({ value: 45, previous: 40 });
      expect(validateSchemaName(r.body, "WorkoutLogWithSets")).toEqual([]);

      const h = await get(history, `/members/${A().ids.kid}/exercises/${A().ids.exA}/history?range=all`, A().token.coach, { memberId: A().ids.kid, exerciseId: A().ids.exA });
      expect(h.status, h.text).toBe(200);
      expect(validateSchemaName(h.body, "ExerciseHistory")).toEqual([]);
      expect(h.body.metricType).toBe("WEIGHT_REPS");
      expect(h.body.sessions.map((s: any) => s.date)).toEqual([d(-1), d(-2)]); // newest first
      expect(h.body.series.heaviestWeight.map((p: any) => [p.date, p.value])).toEqual([[d(-2), 40], [d(-1), 45]]);
      expect(h.body.series.oneRepMax.length).toBe(2);
      expect(h.body.records.heaviestWeight).toEqual({ value: 45, date: d(-1) });
      expect(h.body.records.weightAtReps.find((r2: any) => r2.reps === 8)).toMatchObject({ weightKg: 45 });
      expect(h.body.newBests.some((n: any) => n.metric === "heaviest_weight" && n.date === d(-1))).toBe(true);
      // Parent reads the same history; the default range is three months.
      const asParent = await get(history, `/x?`, A().token.parent, { memberId: A().ids.kid, exerciseId: A().ids.exA });
      expect(asParent.body.range).toBe("3m");
      expect(asParent.body.sessions.length).toBe(2);
    });

    it("rejects an unknown range and an exercise of another tenant", async (ctx) => {
      if (!prisma) return ctx.skip();
      const call2 = (url: string, token: string, params: Record<string, string>) => call(history, "GET", url, token, { params });
      const bad = await call2(`/members/${A().ids.kid}/exercises/${A().ids.exA}/history?range=2y`, A().token.coach, { memberId: A().ids.kid, exerciseId: A().ids.exA });
      expect(bad.status).toBe(400);
      const foreign = await call2(`/members/${A().ids.kid}/exercises/${B().ids.exA}/history`, A().token.coach, { memberId: A().ids.kid, exerciseId: B().ids.exA });
      expect(foreign.status).toBe(404);
      const outsider = await call2(`/members/${A().ids.kid}/exercises/${A().ids.exA}/history`, A().token.stranger, { memberId: A().ids.kid, exerciseId: A().ids.exA });
      expect(outsider.status).toBe(403);
    });

    it("listWorkoutSets pages the sets of a member and filters by exercise and log", async (ctx) => {
      if (!prisma) return ctx.skip();
      const r = await call(listSets, "GET", `/members/${A().ids.kid}/workout-sets?limit=3`, A().token.parent, { params: { memberId: A().ids.kid } });
      expect(r.status, r.text).toBe(200);
      expect(validateSchemaName(r.body, "WorkoutSetPage")).toEqual([]);
      expect(r.body.items.length).toBe(3);
      expect(r.body.nextCursor).toBeTruthy();
      expect(r.body.items[0].scheduledFor).toBe(d(-1)); // newest day first
      const one = await call(listSets, "GET", `/members/${A().ids.kid}/workout-sets?logId=${x.log1}`, A().token.coach, { params: { memberId: A().ids.kid } });
      expect(one.body.items.map((s: any) => s.logId)).toEqual([x.log1, x.log1, x.log1]);
      const none = await call(listSets, "GET", `/members/${A().ids.kid}/workout-sets?exerciseId=${A().ids.exB}`, A().token.coach, { params: { memberId: A().ids.kid } });
      expect(none.body.items).toEqual([]);
      const outsider = await call(listSets, "GET", `/members/${A().ids.kid}/workout-sets`, A().token.stranger, { params: { memberId: A().ids.kid } });
      expect(outsider.status).toBe(403);
    });

    it("validates the body", async (ctx) => {
      if (!prisma) return ctx.skip();
      const bad = async (body: any, field: string) => {
        const r = await put(putSets, "/workout-sets", A().token.parent, body);
        expect(r.status, JSON.stringify(body)).toBe(400);
        expect(JSON.stringify(r.body.error.details)).toContain(field);
      };
      await bad(setsBody(d(-1), []), "sets");
      await bad(setsBody(d(-1), [{ clientId: `s-${uniq()}`, setNumber: 1 }]), "sets[0]");
      await bad(setsBody(d(-1), [aSet(1, { scoreMade: 3 })]), "scoreMade");
      await bad(setsBody(d(-1), [aSet(1, { scoreMade: 9, scoreOf: 5 })]), "scoreMade");
      await bad(setsBody(d(-1), [aSet(1, { rating: 5 })]), "rating");
      await bad(setsBody(d(-1), [aSet(1, { setType: "heavy" })]), "setType");
      await bad(setsBody(d(-1), [aSet(1), aSet(1)]), "setNumber");
      await bad(setsBody(d(1), [aSet(1)]), "scheduledFor");
      await bad({ ...setsBody(d(-1), [aSet(1)]), clientId: "short" }, "clientId");
      // A date on which the item is not scheduled (before the assignment started).
      await bad(setsBody(d(-10), [aSet(1)]), "planItemId");
    });

    it("refuses a set clientId that belongs to another log, a log clientId reused for another item, and a skipped item", async (ctx) => {
      if (!prisma) return ctx.skip();
      const taken = x.firstBody.sets[1].clientId;
      const second = (await prisma.workoutPlanItem.findFirstOrThrow({ where: { dayId: A().ids.planDay, id: { not: A().ids.planItem } } })).id;
      const other = await put(putSets, "/workout-sets", A().token.parent, setsBody(d(-2), [{ clientId: taken, setNumber: 1, seconds: 45 }], {}, second));
      expect(other.status, other.text).toBe(409);
      expect(await prisma.workoutLog.count({ where: { tenantId: A().id, planItemId: second } })).toBe(0); // rolled back with the failed set
      const reuse = await put(putSets, "/workout-sets", A().token.parent, { ...setsBody(d(-1), [aSet(1)]), clientId: x.firstBody.clientId });
      expect(reuse.status).toBe(409); // same log clientId, but another date
      const skip = await put(putLog, "/workout-logs", A().token.parent, { clientId: `skip-${uniq()}`, assignmentId: A().ids.assignment, planItemId: second, scheduledFor: d(-2), action: "skip" });
      expect(skip.status, skip.text).toBe(200);
      const onSkipped = await put(putSets, "/workout-sets", A().token.parent, setsBody(d(-2), [{ clientId: `s-${uniq()}`, setNumber: 1, seconds: 45 }], {}, second));
      expect(onSkipped.status).toBe(409);
    });

    it("keeps roles and views: the other coach and the owner cannot log, an outsider family cannot see", async (ctx) => {
      if (!prisma) return ctx.skip();
      const body = setsBody(d(-1), [aSet(9)]);
      expect((await put(putSets, "/workout-sets", A().token.coachX, body)).status).toBe(403);
      expect((await put(putSets, "/workout-sets", A().token.owner, body)).status).toBe(403);
      expect((await put(putSets, "/workout-sets", A().token.stranger, body)).status).toBe(403);
      expect((await put(putSets, "/workout-sets", undefined, body)).status).toBe(401);
      expect((await put(putSets, "/workout-sets", B().token.coach, body)).status).toBe(404);
      // The coach of the member can log for them (and the sets carry through to history).
      const ok = await put(putSets, "/workout-sets", A().token.coach, setsBody(d(0), [aSet(1, { weightKg: 47.5, reps: 5 })]));
      expect(ok.status, ok.text).toBe(200);
    });

    it("stores one log per tenant clientId and never lets one tenant's set land in another", async (ctx) => {
      if (!prisma) return ctx.skip();
      expect(await prisma.workoutSet.count({ where: { tenantId: B().id } })).toBe(0);
    });
  });

  // ---------------------------------------------------------------- supersets in plans

  describe("supersets and rounds", () => {
    const item = (exerciseId: string, position: number, extra: Record<string, unknown> = {}) => ({ exerciseId, position, sets: 3, reps: 10, ...extra });
    const plan = (items: any[], title = `Superset plan ${uniq()}`) => ({ title, cadence: "daily", days: [{ dayIndex: 1, title: "Day", items }] });

    it("creates a plan with a superset and returns render-ready blocks plus the new fields", async (ctx) => {
      if (!prisma) return ctx.skip();
      const { exA, exB } = A().ids;
      const r = await post(createPlan, "/workout-plans", A().token.coach, plan([
        item(exA, 1),
        item(exB, 2, { supersetGroup: "A", rounds: 3, targetWeightKg: 12.5 }),
        item(exA, 3, { supersetGroup: "A", rounds: 3, durationSeconds: 30, reps: undefined }),
        item(exB, 4, { reps: undefined, targetDistanceMeters: 400 }),
      ]));
      expect(r.status, r.text).toBe(201);
      expect(validateSchemaName(r.body, "WorkoutPlan")).toEqual([]);
      const day = r.body.days[0];
      expect(day.blocks.map((b: any) => [b.type, b.label, b.rounds, b.items.length])).toEqual([["single", null, null, 1], ["superset", "A", 3, 2], ["single", null, null, 1]]);
      expect(day.items[1]).toMatchObject({ supersetGroup: "A", rounds: 3, targetWeightKg: 12.5, targetDistanceMeters: null, metricType: "WEIGHT_REPS" });
      expect(day.items[3]).toMatchObject({ targetDistanceMeters: 400, reps: null, durationSeconds: null });
      x.superPlan = r.body;
    });

    it("rejects a group of one, a gap inside a group, different rounds, rounds without a group and a bad label", async (ctx) => {
      if (!prisma) return ctx.skip();
      const { exA, exB } = A().ids;
      const bad = async (items: any[], field: string) => {
        const r = await post(createPlan, "/workout-plans", A().token.coach, plan(items));
        expect(r.status, JSON.stringify(items)).toBe(400);
        expect(JSON.stringify(r.body.error.details)).toContain(field);
      };
      await bad([item(exA, 1, { supersetGroup: "A", rounds: 3 }), item(exB, 2)], "items[0].supersetGroup");
      await bad([item(exA, 1, { supersetGroup: "A", rounds: 3 }), item(exB, 2), item(exA, 3, { supersetGroup: "A", rounds: 3 })], "supersetGroup");
      await bad([item(exA, 1, { supersetGroup: "A", rounds: 3 }), item(exB, 2, { supersetGroup: "A", rounds: 2 })], "rounds");
      await bad([item(exA, 1, { rounds: 3 }), item(exB, 2)], "items[0].rounds");
      await bad([item(exA, 1, { supersetGroup: "way too long", rounds: 3 }), item(exB, 2, { supersetGroup: "way too long", rounds: 3 })], "supersetGroup");
      await bad([item(exA, 1, { reps: undefined })], "reps or durationSeconds");
    });

    it("updating a plan keeps and changes supersets; the member's schedule shows the blocks", async (ctx) => {
      if (!prisma) return ctx.skip();
      const p = x.superPlan;
      const items = p.days[0].items.map((i: any) => ({ id: i.id, exerciseId: i.exerciseId, position: i.position, sets: i.sets, reps: i.reps, durationSeconds: i.durationSeconds, supersetGroup: i.supersetGroup, rounds: i.rounds === 3 ? 4 : i.rounds, targetWeightKg: i.targetWeightKg, targetDistanceMeters: i.targetDistanceMeters }));
      const r = await put(updatePlan, "/workout-plans/x", A().token.coach, { ...plan(items, p.title), expectedVersion: p.version }, { planId: p.id });
      expect(r.status, r.text).toBe(200);
      expect(r.body.days[0].blocks[1]).toMatchObject({ type: "superset", label: "A", rounds: 4 });
      const asg = await post(createAssignments, "/plan-assignments", A().token.coach, { planId: p.id, memberIds: [A().ids.kid], startsOn: d(0) });
      expect(asg.status, asg.text).toBe(201);
      const sched = await call(getSchedule, "GET", `/members/${A().ids.kid}/schedule?from=${d(0)}&to=${d(0)}`, A().token.parent, { params: { memberId: A().ids.kid } });
      expect(sched.status, sched.text).toBe(200);
      expect(validateSchemaName(sched.body, "MemberSchedule")).toEqual([]);
      const blocks = sched.body.days[0].blocks.filter((b: any) => b.items.some((i: any) => i.planId === p.id));
      expect(blocks.map((b: any) => b.type)).toContain("superset");
      const sup = blocks.find((b: any) => b.type === "superset");
      expect(sup.items.map((i: any) => i.supersetGroup)).toEqual(["A", "A"]);
      expect(sup.items[0].metricType).toBe("WEIGHT_REPS");
      // Plan read as the customer: same blocks.
      const read = await get(getPlan, "/workout-plans/x", A().token.parent, { planId: p.id });
      expect(read.status).toBe(200);
      expect(read.body.days[0].blocks.length).toBe(3);
    });
  });

  // ---------------------------------------------------------------- class workout and summary

  describe("class workout, after-class summary and share link", () => {
    const names = { absent: "Omar Absentee", excused: "Pria Excused" };

    beforeAll(async () => {
      if (!prisma) return;
      const mk = async (displayName: string) => {
        const m = await prisma!.member.create({ data: { tenantId: A().id, displayName, isMinor: true, joinedOn: new Date(`${d(-60)}T00:00:00Z`) } });
        await prisma!.batchMember.create({ data: { tenantId: A().id, batchId: A().ids.batch1, memberId: m.id, joinedOn: new Date(`${d(-60)}T00:00:00Z`) } });
        return m.id;
      };
      x.absent = await mk(names.absent);
      x.excused = await mk(names.excused);
      const now = Date.now();
      x.classSession = (await prisma.session.create({ data: { tenantId: A().id, batchId: A().ids.batch1, coachId: A().user.coach, startsAt: new Date(now - 3 * 3_600_000), endsAt: new Date(now - 2 * 3_600_000) } })).id;
      x.plainSession = (await prisma.session.create({ data: { tenantId: A().id, batchId: A().ids.batch1, coachId: A().user.coach, startsAt: new Date(now - 6 * 3_600_000), endsAt: new Date(now - 5 * 3_600_000) } })).id;
    });

    const roll = (sessionId: string, token: string, complete = true, coachNote?: string) =>
      put(putAttendance, "/x", token, {
        entries: [
          { memberId: A().ids.kid, status: "present", clientId: `att-${sessionId}-kid`.slice(0, 64) },
          { memberId: x.absent, status: "absent", clientId: `att-${sessionId}-abs`.slice(0, 64) },
          { memberId: x.excused, status: "excused", reason: "illness", clientId: `att-${sessionId}-exc`.slice(0, 64) },
        ],
        complete,
        ...(coachNote ? { coachNote } : {}),
      }, { sessionId });

    it("attaches a plan day as the class workout; customers of the batch can read it, outsiders cannot", async (ctx) => {
      if (!prisma) return ctx.skip();
      const r = await put(attachWorkout, "/x", A().token.coach, { planDayId: A().ids.planDay }, { sessionId: x.classSession });
      expect(r.status, r.text).toBe(200);
      expect(validateSchemaName(r.body, "SessionWorkout")).toEqual([]);
      expect(r.body.workout.blocks.flatMap((b: any) => b.items).map((i: any) => i.exerciseName).length).toBe(2);
      const read = await get(getWorkout, "/x", A().token.parent, { sessionId: x.classSession });
      expect(read.status).toBe(200);
      expect(read.body.planDayId).toBe(A().ids.planDay);
      expect((await get(getWorkout, "/x", A().token.stranger, { sessionId: x.classSession })).status).toBe(403);
      expect((await put(attachWorkout, "/x", A().token.coachX, { planDayId: A().ids.planDay }, { sessionId: x.classSession })).status).toBe(403);
      expect((await put(attachWorkout, "/x", A().token.parent, { planDayId: A().ids.planDay }, { sessionId: x.classSession })).status).toBe(403);
      expect((await put(attachWorkout, "/x", A().token.coach, { planDayId: B().ids.planDay }, { sessionId: x.classSession })).status).toBe(404);
      expect((await put(attachWorkout, "/x", A().token.coach, {}, { sessionId: x.classSession })).status).toBe(400);
    });

    it("finishing the roll call publishes the summary and tells present, absent and excused members in their own words", async (ctx) => {
      if (!prisma) return ctx.skip();
      expect(await prisma.classSummary.count({ where: { sessionId: x.classSession } })).toBe(0);
      const r = await roll(x.classSession, A().token.coach, true, "Sharp work today");
      expect(r.status, r.text).toBe(200);
      const kinds = async (memberId: string) => (await prisma!.memberUpdate.findMany({ where: { memberId, entityType: "class_summary", entityId: x.classSession } })).map((u) => u.kind);
      expect(await kinds(A().ids.kid)).toEqual(["CLASS_SUMMARY"]);
      expect(await kinds(x.absent)).toEqual(["CLASS_CATCHUP"]);
      expect(await kinds(x.excused)).toEqual(["CLASS_CATCHUP_EXCUSED"]);
      const summary = await prisma.classSummary.findFirstOrThrow({ where: { sessionId: x.classSession } });
      expect(summary.coachNote).toBe("Sharp work today");
      // A replay of the same roll call tells nobody twice.
      expect((await roll(x.classSession, A().token.coach, true)).status).toBe(200);
      expect(await prisma.memberUpdate.count({ where: { entityType: "class_summary", entityId: x.classSession } })).toBe(3);
      // The member feed carries the new kind with only the class name and date.
      const feed = await call(listUpdates, "GET", `/members/${A().ids.kid}/updates`, A().token.parent, { params: { memberId: A().ids.kid } });
      expect(validateSchemaName(feed.body, "MemberUpdatePage")).toEqual([]);
      const u = feed.body.items.find((i: any) => i.kind === "class_summary");
      expect(u.entityType).toBe("class_summary");
      expect(Object.keys(u.params).sort()).toEqual(["batchName", "date"]);
    });

    it("getClassSummary: customers name their member and see only their own view, owner and coach also get counts", async (ctx) => {
      if (!prisma) return ctx.skip();
      const mine = await call(getSummary, "GET", `/x?memberId=${A().ids.kid}`, A().token.parent, { params: { sessionId: x.classSession } });
      expect(mine.status, mine.text).toBe(200);
      expect(validateSchemaName(mine.body, "ClassSummary")).toEqual([]);
      expect(mine.body.forMember).toMatchObject({ status: "present", titleKey: "cs.present.title", bodyKey: "cs.present.body" });
      expect(mine.body.forMember.params.firstName).toBe("QA");
      expect(mine.body.counts).toBeNull();
      expect(mine.body.coachNote).toBe("Sharp work today");
      expect(mine.body.workout.blocks.length).toBeGreaterThan(0);
      expect(mine.text).not.toContain("Omar");
      expect(mine.text).not.toContain("Pria");
      expect(mine.text).not.toContain(x.absent);

      const noMember = await call(getSummary, "GET", `/x`, A().token.parent, { params: { sessionId: x.classSession } });
      expect(noMember.status).toBe(400);
      const outsider = await call(getSummary, "GET", `/x?memberId=${A().ids.kid}`, A().token.stranger, { params: { sessionId: x.classSession } });
      expect(outsider.status).toBe(403);

      const coach = await call(getSummary, "GET", `/x`, A().token.coach, { params: { sessionId: x.classSession } });
      expect(coach.status).toBe(200);
      expect(coach.body.counts).toEqual({ present: 1, absent: 1, excused: 1 });
      expect(coach.body.forMember).toBeNull();
      const absentView = await call(getSummary, "GET", `/x?memberId=${x.absent}`, A().token.owner, { params: { sessionId: x.classSession } });
      expect(absentView.body.forMember).toMatchObject({ status: "absent", titleKey: "cs.absent.title" });
      expect(absentView.body.forMember.params.firstName).toBe("Omar");
      const excusedView = await call(getSummary, "GET", `/x?memberId=${x.excused}`, A().token.owner, { params: { sessionId: x.classSession } });
      expect(excusedView.body.forMember).toMatchObject({ status: "excused", titleKey: "cs.excused.title", bodyKey: "cs.excused.body" });
      expect(excusedView.body.coachNote).toBe("Sharp work today");
    });

    it("a class without a workout publishes nothing on its own; publishClassSummary adds a summary on demand and is safe to repeat", async (ctx) => {
      if (!prisma) return ctx.skip();
      await roll(x.plainSession, A().token.coach, true);
      expect(await prisma.classSummary.count({ where: { sessionId: x.plainSession } })).toBe(0);
      const none = await call(getSummary, "GET", `/x`, A().token.coach, { params: { sessionId: x.plainSession } });
      expect(none.status).toBe(404);
      const r = await post(publishSummary, "/x", A().token.coach, { coachNote: "Notes only", homePractice: "Stretch for five minutes" }, { sessionId: x.plainSession });
      expect(r.status, r.text).toBe(200);
      expect(validateSchemaName(r.body, "ClassSummary")).toEqual([]);
      expect(r.body.workout).toBeNull();
      expect(r.body.homePractice).toBe("Stretch for five minutes");
      const again = await post(publishSummary, "/x", A().token.owner, { homePractice: "Stretch for ten minutes" }, { sessionId: x.plainSession });
      expect(again.status).toBe(200);
      expect(again.body.coachNote).toBe("Notes only");
      expect(again.body.homePractice).toBe("Stretch for ten minutes");
      expect(await prisma.memberUpdate.count({ where: { entityType: "class_summary", entityId: x.plainSession } })).toBe(3);
      expect(await prisma.classSummary.count({ where: { sessionId: x.plainSession } })).toBe(1);
      expect((await post(publishSummary, "/x", A().token.coachX, {}, { sessionId: x.plainSession })).status).toBe(403);
      expect((await post(publishSummary, "/x", A().token.parent, {}, { sessionId: x.plainSession })).status).toBe(403);
      expect((await post(publishSummary, "/x", A().token.coach, { coachNote: 5 }, { sessionId: x.plainSession })).status).toBe(400);
      // A class that has not started has nothing to summarise yet.
      expect((await post(publishSummary, "/x", A().token.coach, {}, { sessionId: A().ids.sessionFuture })).status).toBe(409);
    });

    it("getMemberClassSummaries lists a member's classes newest first", async (ctx) => {
      if (!prisma) return ctx.skip();
      const r = await call(memberSummaries, "GET", `/x`, A().token.parent, { params: { memberId: A().ids.kid } });
      expect(r.status, r.text).toBe(200);
      expect(validateSchemaName(r.body, "ClassSummaryPage")).toEqual([]);
      expect(r.body.items.map((i: any) => i.sessionId)).toEqual([x.classSession, x.plainSession, A().ids.sessionDone].filter((id) => r.body.items.some((i: any) => i.sessionId === id)));
      expect(r.body.items.every((i: any) => i.forMember.memberId === A().ids.kid)).toBe(true);
      expect(r.text).not.toContain("Omar");
      expect((await call(memberSummaries, "GET", `/x`, A().token.stranger, { params: { memberId: A().ids.kid } })).status).toBe(403);
    });

    it("share link: hash-only storage, 30 days, first name only, noindex; expired, revoked and unknown tokens are the same 404", async (ctx) => {
      if (!prisma) return ctx.skip();
      const made = await post(createShare, "/x", A().token.parent, { memberId: A().ids.kid }, { sessionId: x.classSession });
      expect(made.status, made.text).toBe(201);
      expect(validateSchemaName(made.body, "ClassSummaryShare")).toEqual([]);
      const token = made.body.url.split("/share/class/")[1];
      expect(token.length).toBeGreaterThan(30);
      // Only the hash is stored.
      const rows = await prisma.classSummaryShare.findMany({ where: { tenantId: A().id, memberId: A().ids.kid } });
      expect(rows.length).toBe(1);
      expect(rows[0].tokenHash).toBe(sha(token));
      expect(JSON.stringify(rows)).not.toContain(token);
      const ttl = new Date(made.body.expiresAt).getTime() - Date.now();
      expect(Math.abs(ttl - SHARE_TTL_MS)).toBeLessThan(60_000);

      const pub = await call(publicSummary, "GET", `/public/class-summaries/${token}`, undefined, { params: { token } });
      expect(pub.status, pub.text).toBe(200);
      expect(validateSchemaName(pub.body, "SharedClassSummary")).toEqual([]);
      expect(pub.body.firstName).toBe("QA");
      expect(pub.body.status).toBe("present");
      expect(pub.text).not.toContain(A().ids.kid);
      expect(pub.text).not.toContain(x.classSession);
      expect(pub.text).not.toContain("Omar");
      expect(pub.text).not.toContain("QA Kid"); // first name only
      const res = await publicSummary(new Request(`http://localhost/api/v1/public/class-summaries/${token}`), { params: Promise.resolve({ token }) });
      expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
      expect(res.headers.get("cache-control")).toBe("no-store");

      const unknown = await call(publicSummary, "GET", `/public/class-summaries/nope`, undefined, { params: { token: "nope" } });
      expect(unknown.status).toBe(404);
      expect(validateSchemaName(unknown.body, "Error")).toEqual([]);
      const later = new Date(Date.now() + SHARE_TTL_MS + 60_000);
      await expect(getSharedClassSummary(token, { client: prisma, now: later })).rejects.toMatchObject({ status: 404 });
      await prisma.classSummaryShare.updateMany({ where: { id: rows[0].id }, data: { revokedAt: new Date() } });
      expect((await call(publicSummary, "GET", `/x`, undefined, { params: { token } })).status).toBe(404);
    });

    it("share links stay inside the family: another family's child, a member who was not in the class, a stranger, another tenant", async (ctx) => {
      if (!prisma) return ctx.skip();
      expect((await post(createShare, "/x", A().token.parent, { memberId: x.absent }, { sessionId: x.classSession })).status).toBe(403);
      expect((await post(createShare, "/x", A().token.stranger, { memberId: A().ids.kid }, { sessionId: x.classSession })).status).toBe(403);
      expect((await post(createShare, "/x", A().token.parent, { memberId: A().ids.m2 }, { sessionId: x.classSession })).status).toBe(403);
      expect((await post(createShare, "/x", A().token.coach, { memberId: A().ids.kid }, { sessionId: B().ids.sessionDone })).status).toBe(404);
      expect((await post(createShare, "/x", A().token.parent, {}, { sessionId: x.classSession })).status).toBe(400);
      // A coach can make the link for the absent child.
      const forAbsent = await post(createShare, "/x", A().token.coach, { memberId: x.absent }, { sessionId: x.classSession });
      expect(forAbsent.status).toBe(201);
      const token = forAbsent.body.url.split("/share/class/")[1];
      const pub = await call(publicSummary, "GET", `/x`, undefined, { params: { token } });
      expect(pub.body).toMatchObject({ status: "absent", firstName: "Omar", titleKey: "cs.absent.title" });
      expect(pub.text).not.toContain("Pria");
    });
  });

  // ---------------------------------------------------------------- skills

  describe("skill and belt checklists", () => {
    const base = () => A().ids;
    const progress = (token: string, memberId = base().kid, q = "") => call(skillProgress, "GET", `/x${q}`, token, { params: { memberId } });
    const sign = (token: string | undefined, body: unknown, memberId = base().kid, skillItemId = base().skillItem) => put(signOff, "/x", token, body, { memberId, skillItemId });

    it("lists the checklists with their belt, in order", async (ctx) => {
      if (!prisma) return ctx.skip();
      const r = await call(listChecklists, "GET", "/skill-checklists", A().token.parent);
      expect(r.status, r.text).toBe(200);
      expect(validateSchemaName(r.body, "SkillChecklistList")).toEqual([]);
      expect(r.body.items.length).toBe(1);
      expect(r.body.items[0]).toMatchObject({ sportSlug: "karate", levelRank: 1, items: [{ id: base().skillItem }] });
      expect(r.text).not.toContain(B().ids.skillChecklist);
      const filtered = await call(listChecklists, "GET", `/x?levelId=${base().level}`, A().token.coach);
      expect(filtered.body.items.length).toBe(1);
      const none = await call(listChecklists, "GET", `/x?sportId=missing`, A().token.coach);
      expect(none.body.items).toEqual([]);
    });

    it("coach signs a skill off with a rating; the parent sees progress and the next belt; clearing takes it back", async (ctx) => {
      if (!prisma) return ctx.skip();
      const before = await progress(A().token.parent);
      expect(before.status, before.text).toBe(200);
      expect(validateSchemaName(before.body, "MemberSkillProgress")).toEqual([]);
      expect(before.body.checklists[0]).toMatchObject({ doneCount: 0, totalCount: 1, percent: 0, complete: false, isNextLevel: true });

      const r = await sign(A().token.coach, { rating: 3, note: "Solid stance" });
      expect(r.status, r.text).toBe(200);
      expect(validateSchemaName(r.body, "SkillSignOff")).toEqual([]);
      expect(r.body).toMatchObject({ rating: 3, note: "Solid stance", signedOffById: A().user.coach, signedOffByName: "QA coach A" });
      const again = await sign(A().token.owner, { rating: 4 }); // replaces
      expect(again.status).toBe(200);
      expect(await prisma.skillSignOff.count({ where: { memberId: base().kid } })).toBe(1);

      const after = await progress(A().token.parent);
      expect(after.body.checklists[0]).toMatchObject({ doneCount: 1, percent: 100, complete: true });
      expect(after.body.checklists[0].items[0]).toMatchObject({ signedOff: true, rating: 4, skillItemId: base().skillItem });
      const filtered = await progress(A().token.coach, base().kid, `?sportId=${base().sport}`);
      expect(filtered.body.checklists.length).toBe(1);

      const cleared = await call(clearSignOff, "DELETE", "/x", A().token.coach, { params: { memberId: base().kid, skillItemId: base().skillItem } });
      expect(cleared.status).toBe(204);
      const twice = await call(clearSignOff, "DELETE", "/x", A().token.coach, { params: { memberId: base().kid, skillItemId: base().skillItem } });
      expect(twice.status).toBe(204);
      expect((await progress(A().token.parent)).body.checklists[0].doneCount).toBe(0);
    });

    it("write is coach and owner only, for their own members; customers read their own only", async (ctx) => {
      if (!prisma) return ctx.skip();
      expect((await sign(A().token.parent, { rating: 3 })).status).toBe(403);
      expect((await sign(A().token.stranger, { rating: 3 })).status).toBe(403);
      expect((await sign(A().token.coachX, { rating: 3 })).status).toBe(403); // not their member
      expect((await sign(undefined, { rating: 3 })).status).toBe(401);
      expect((await sign(B().token.coach, { rating: 3 })).status).toBe(404);
      expect((await call(clearSignOff, "DELETE", "/x", A().token.parent, { params: { memberId: base().kid, skillItemId: base().skillItem } })).status).toBe(403);
      expect((await call(clearSignOff, "DELETE", "/x", A().token.coachX, { params: { memberId: base().kid, skillItemId: base().skillItem } })).status).toBe(403);
      expect((await progress(A().token.stranger)).status).toBe(403);
      expect((await progress(A().token.coachX)).status).toBe(403);
      expect((await progress(B().token.owner)).status).toBe(404);
      for (const bad of [{ rating: 0 }, { rating: 5 }, { rating: 2.5 }, {}, { rating: "3" }, { rating: 3, note: "x".repeat(281) }]) {
        expect((await sign(A().token.coach, bad)).status, JSON.stringify(bad)).toBe(400);
      }
      expect((await sign(A().token.coach, { rating: 3 }, base().kid, B().ids.skillItem)).status).toBe(404);
      expect((await call(clearSignOff, "DELETE", "/x", A().token.coach, { params: { memberId: base().kid, skillItemId: B().ids.skillItem } })).status).toBe(404);
      // Nothing was written by the denied calls.
      expect(await prisma.skillSignOff.count({ where: { tenantId: A().id } })).toBe(0);
    });

    it("the next belt follows the member's level timeline", async (ctx) => {
      if (!prisma) return ctx.skip();
      await prisma.memberLevel.create({ data: { tenantId: A().id, memberId: base().kid, levelId: base().level, achievedOn: new Date(`${d(-5)}T00:00:00Z`) } });
      const r = await progress(A().token.coach);
      expect(r.body.currentLevels).toEqual([{ sportId: base().sport, levelId: base().level, levelName: "White A", rank: 1, achievedOn: d(-5) }]);
      expect(r.body.checklists[0].isNextLevel).toBe(false); // already at that level
    });
  });

  // ---------------------------------------------------------------- bulk send and results

  describe("sendPlanToMembers and getPlanResults", () => {
    let planId = "";
    let extra = "";
    beforeAll(async () => {
      if (!prisma) return;
      planId = (await A().fresh.plan()).id;
      const m = await prisma.member.create({ data: { tenantId: A().id, displayName: "Bulk Member", joinedOn: new Date(`${d(-30)}T00:00:00Z`) } });
      await prisma.batchMember.create({ data: { tenantId: A().id, batchId: A().ids.batch1, memberId: m.id, joinedOn: new Date(`${d(-30)}T00:00:00Z`) } });
      extra = m.id;
    });
    const send = (token: string | undefined, body: unknown) => post(bulkSend, "/plan-assignments/bulk", token, body);

    it("sends to several members in one call, once: sent, then already_sent, then skipped_active for another start date", async (ctx) => {
      if (!prisma) return ctx.skip();
      const body = { planId, memberIds: [A().ids.kid, extra], startsOn: d(1), repeat: { mode: "weeks", weeks: 2 }, note: "Start on Monday" };
      const r = await send(A().token.coach, body);
      expect(r.status, r.text).toBe(200);
      expect(validateSchemaName(r.body, "BulkSendResult")).toEqual([]);
      expect(r.body.results.map((x2: any) => [x2.memberId, x2.status])).toEqual([[A().ids.kid, "sent"], [extra, "sent"]]);
      expect(r.body).toMatchObject({ sentCount: 2, alreadySentCount: 0, skippedCount: 0, startsOn: d(1), endsOn: d(14) });
      const rows = await prisma.planAssignment.findMany({ where: { planId } });
      expect(rows.length).toBe(2);
      expect(rows.every((a) => a.note === "Start on Monday" && a.assignedById === A().user.coach)).toBe(true);
      expect(await prisma.memberUpdate.count({ where: { entityType: "assignment", kind: "PLAN_ASSIGNED", entityId: { in: rows.map((a) => a.id) } } })).toBe(2);

      const replay = await send(A().token.coach, body);
      expect(replay.status).toBe(200);
      expect(replay.body.results.map((x2: any) => x2.status)).toEqual(["already_sent", "already_sent"]);
      expect(replay.body.results.map((x2: any) => x2.assignmentId).sort()).toEqual(rows.map((a) => a.id).sort());
      expect(await prisma.planAssignment.count({ where: { planId } })).toBe(2);
      expect(await prisma.memberUpdate.count({ where: { entityType: "assignment", kind: "PLAN_ASSIGNED", entityId: { in: rows.map((a) => a.id) } } })).toBe(2);

      const another = await send(A().token.coach, { planId, memberIds: [A().ids.kid], startsOn: d(2) });
      expect(another.body.results[0].status).toBe("skipped_active");
      expect(another.body.endsOn).toBeNull();
      expect(await prisma.planAssignment.count({ where: { planId } })).toBe(2);
    });

    it("repeat modes decide the end date; bad input is a 400 and writes nothing", async (ctx) => {
      if (!prisma) return ctx.skip();
      const fresh = async () => (await A().fresh.plan()).id;
      const once = await send(A().token.coach, { planId: await fresh(), memberIds: [A().ids.kid], startsOn: d(3), repeat: { mode: "once" } });
      expect(once.body.endsOn).toBe(d(3));
      const until = await send(A().token.coach, { planId: await fresh(), memberIds: [A().ids.kid], startsOn: d(3), repeat: { mode: "until", endsOn: d(20) } });
      expect(until.body.endsOn).toBe(d(20));
      const ongoing = await send(A().token.owner, { planId: await fresh(), memberIds: [A().ids.kid], startsOn: d(3), repeat: { mode: "ongoing" } });
      expect(ongoing.status).toBe(200);
      expect(ongoing.body.endsOn).toBeNull();
      const p = await fresh();
      for (const bad of [
        { planId: p, memberIds: [], startsOn: d(1) },
        { planId: p, memberIds: [A().ids.kid], startsOn: "tomorrow" },
        { planId: p, memberIds: [A().ids.kid], startsOn: d(1), repeat: { mode: "weeks" } },
        { planId: p, memberIds: [A().ids.kid], startsOn: d(1), repeat: { mode: "until", endsOn: d(-4) } },
        { planId: p, memberIds: [A().ids.kid], startsOn: d(1), repeat: { mode: "daily" } },
        { planId: p, memberIds: Array.from({ length: 101 }, (_, i) => `m${i}`), startsOn: d(1) },
        { planId: p, memberIds: [A().ids.kid], startsOn: d(1), note: "n".repeat(281) },
      ]) {
        expect((await send(A().token.coach, bad)).status, JSON.stringify(bad).slice(0, 80)).toBe(400);
      }
      expect(await prisma.planAssignment.count({ where: { planId: p } })).toBe(0);
    });

    it("nothing is written when a member or the plan is not the caller's or does not exist", async (ctx) => {
      if (!prisma) return ctx.skip();
      const p = (await A().fresh.plan()).id;
      const before = await prisma.planAssignment.count({ where: { tenantId: A().id } });
      expect((await send(A().token.coachX, { planId: p, memberIds: [A().ids.kid], startsOn: d(1) })).status).toBe(403); // plan not theirs
      expect((await send(A().token.coach, { planId: p, memberIds: [A().ids.kid, A().ids.m2], startsOn: d(1) })).status).toBe(403); // m2 is coachX's
      expect((await send(A().token.coach, { planId: p, memberIds: [A().ids.kid, "missing"], startsOn: d(1) })).status).toBe(404);
      expect((await send(A().token.coach, { planId: B().ids.plan, memberIds: [A().ids.kid], startsOn: d(1) })).status).toBe(404);
      expect((await send(A().token.coach, { planId: p, memberIds: [B().ids.kid], startsOn: d(1) })).status).toBe(404);
      expect((await send(A().token.parent, { planId: p, memberIds: [A().ids.kid], startsOn: d(1) })).status).toBe(403);
      expect((await send(undefined, { planId: p, memberIds: [A().ids.kid], startsOn: d(1) })).status).toBe(401);
      expect(await prisma.planAssignment.count({ where: { tenantId: A().id } })).toBe(before);
      // An archived plan cannot be sent.
      await prisma.workoutPlan.update({ where: { id: p }, data: { status: "ARCHIVED" } });
      expect((await send(A().token.coach, { planId: p, memberIds: [A().ids.kid], startsOn: d(1) })).status).toBe(409);
    });

    it("results: one call returns what each member logged per set, the member's note and the new bests", async (ctx) => {
      if (!prisma) return ctx.skip();
      const results = (token: string, planId2: string, q = "") => call(planResults, "GET", `/x${q}`, token, { params: { planId: planId2 } });
      const r = await results(A().token.coach, A().ids.plan, `?from=${d(-5)}&to=${d(0)}`);
      expect(r.status, r.text).toBe(200);
      expect(validateSchemaName(r.body, "PlanResults")).toEqual([]);
      const kid = r.body.items.find((i: any) => i.memberId === A().ids.kid);
      expect(kid.memberName).toBe("QA Kid A");
      expect(kid.daysLogged).toBeGreaterThanOrEqual(2);
      expect(kid.setCount).toBeGreaterThanOrEqual(5);
      expect(kid.days[0].date >= kid.days[1].date).toBe(true); // newest first
      const day2 = kid.days.find((dd: any) => dd.date === d(-2));
      const front = day2.items.find((i: any) => i.planItemId === A().ids.planItem);
      expect(front).toMatchObject({ status: "completed", note: "Felt strong", exerciseName: "Front kick A" });
      expect(front.sets.length).toBe(3);
      const day1 = kid.days.find((dd: any) => dd.date === d(-1));
      expect(day1.items.find((i: any) => i.planItemId === A().ids.planItem).newBests.some((n: any) => n.metric === "heaviest_weight")).toBe(true);
      expect(kid.newBestCount).toBeGreaterThan(0);

      const one = await results(A().token.owner, A().ids.plan, `?memberId=${A().ids.kid}`);
      expect(one.status).toBe(200);
      expect(one.body.items.length).toBe(1);
      expect(one.body.to).toBe(d(0));
      expect((await results(A().token.coachX, A().ids.plan)).status).toBe(403);
      expect((await results(A().token.parent, A().ids.plan)).status).toBe(403);
      expect((await results(B().token.coach, A().ids.plan)).status).toBe(404);
      expect((await results(A().token.coach, A().ids.plan, `?from=${d(-200)}&to=${d(0)}`)).status).toBe(400);
      expect((await results(A().token.coach, A().ids.plan, `?memberId=nope`)).status).toBe(404);
    });
  });

  // ---------------------------------------------------------------- class insights

  describe("getClassInsights", () => {
    it("reports fill, attendance, waitlist and workout share per slot, with suggestions from demand and no coach in the data", async (ctx) => {
      if (!prisma) return ctx.skip();
      const t = A().id;
      const hour = 3_600_000;
      // batch2 (capacity 3): three completed classes with one person each = a quiet slot.
      for (let i = 1; i <= 3; i++) {
        const s = await prisma.session.create({ data: { tenantId: t, batchId: A().ids.batch2, coachId: A().user.coachX, startsAt: new Date(Date.now() - (i * 24 + 5) * hour), endsAt: new Date(Date.now() - (i * 24 + 4) * hour), status: "COMPLETED", completedAt: new Date(Date.now() - (i * 24 + 4) * hour), planDayId: i === 1 ? A().ids.planDay : null } });
        await prisma.attendance.create({ data: { tenantId: t, sessionId: s.id, memberId: A().ids.m2, status: "PRESENT", clientId: `ins-${uniq()}-${i}`, markedById: A().user.coachX } });
      }
      // batch1: three people waiting for an upcoming class.
      const waiters = [];
      for (let i = 0; i < 3; i++) waiters.push((await prisma.member.create({ data: { tenantId: t, displayName: `Waiter ${i}`, joinedOn: new Date(`${d(-9)}T00:00:00Z`) } })).id);
      const upcoming = await A().fresh.futureSession();
      for (const [i, memberId] of waiters.entries()) {
        await prisma.sessionBooking.create({ data: { tenantId: t, sessionId: upcoming, memberId, status: "WAITLISTED", waitlistPosition: i + 1, bookedById: A().user.owner } });
      }

      const r = await call(insights, "GET", "/analytics/classes", A().token.owner);
      expect(r.status, r.text).toBe(200);
      expect(validateSchemaName(r.body, "ClassInsights")).toEqual([]);
      expect(r.body.range).toBe("28d");
      const s1 = r.body.slots.find((s: any) => s.batchId === A().ids.batch1);
      const s2 = r.body.slots.find((s: any) => s.batchId === A().ids.batch2);
      expect(s2).toMatchObject({ sessionCount: 3, capacity: 3, avgFillRate: 33.3, attendanceRate: 100, workoutSentShare: 33.3, quietSlot: true, waitlistCount: 0 });
      expect(s1.waitlistCount).toBe(3);
      expect(s1.quietSlot).toBe(false);
      expect(r.body.suggestions.map((s: any) => [s.kind, s.batchId])).toEqual([["add_class", A().ids.batch1], ["move_slot", A().ids.batch2]]);
      expect(r.body.suggestions[0]).toMatchObject({ messageKey: "ci.addClass", params: { batchName: "Batch one A", waitlistCount: 3 } });
      expect(r.body.suggestions[1].params).toMatchObject({ batchName: "Batch two A", targetBatchName: "Batch one A" });
      // Visibility only: no coach is named or ranked anywhere in the response.
      expect(r.text).not.toMatch(/QA coach|coachId|coachName/i);

      const wide = await call(insights, "GET", "/analytics/classes?range=90d", A().token.owner);
      expect(wide.body.range).toBe("90d");
      expect((await call(insights, "GET", "/analytics/classes?range=1y", A().token.owner)).status).toBe(400);
      expect((await call(insights, "GET", "/analytics/classes", A().token.coach)).status).toBe(403);
      expect((await call(insights, "GET", "/analytics/classes", A().token.parent)).status).toBe(403);
      // Tenant B sees none of it.
      const b = await call(insights, "GET", "/analytics/classes", B().token.owner);
      expect(b.body.slots.every((s: any) => s.batchId !== A().ids.batch1 && s.waitlistCount === 0)).toBe(true);
      expect(b.body.suggestions).toEqual([]);
    });
  });

  // ---------------------------------------------------------------- schema

  describe("schema guards", () => {
    it("the database refuses broken workout data on its own", async (ctx) => {
      if (!prisma) return ctx.skip();
      const t = A().id;
      const day = await prisma.workoutPlanDay.findFirstOrThrow({ where: { tenantId: t } });
      const item = { tenantId: t, dayId: day.id, exerciseId: A().ids.exA, position: 40 };
      await expect(prisma.workoutPlanItem.create({ data: item })).rejects.toThrow(); // no reps, time or distance
      const ok = await prisma.workoutPlanItem.create({ data: { ...item, targetDistanceMeters: 50 } }); // distance work needs no reps
      await expect(prisma.workoutPlanItem.create({ data: { ...item, position: 41, reps: 5, rounds: 3 } })).rejects.toThrow(); // rounds need a group
      await prisma.workoutPlanItem.delete({ where: { id: ok.id } });
      await expect(prisma.$executeRawUnsafe(`INSERT INTO workout_sets (id, tenant_id, log_id, set_number, rating, client_id) SELECT 'x-${uniq()}', tenant_id, id, 1, 7, 'bad-${uniq()}' FROM workout_logs WHERE tenant_id = '${t}' LIMIT 1`)).rejects.toThrow();
      const s = await prisma.skillItem.findFirstOrThrow({ where: { tenantId: t } });
      await expect(prisma.skillSignOff.create({ data: { tenantId: t, memberId: A().ids.kid, skillItemId: s.id, rating: 9 } })).rejects.toThrow();
    });
  });
});
