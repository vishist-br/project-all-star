/**
 * STAR-74: role matrix and tenant isolation for EVERY operation in docs/api/openapi.yaml.
 *
 * The matrix is generated from the contract: operations, paths, methods, x-roles and success
 * codes come from the YAML, handlers are discovered from app/api/v1/**\/route.ts. A new
 * operation without a CASES entry (or a new route file) fails the coverage tests below.
 * For each operation, with real handlers and real sessions, it asserts per actor
 *   anonymous 401 | wrong role 403 | own rows 2xx | another coach's / family's rows 403 |
 *   other tenant's ids 404 (both directions) | success bodies match the contract schema |
 *   no id of the other tenant ever appears in a response body | writes never touch the other tenant.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { tryConnect } from "./helpers-db";
import { validate, validateSchemaName } from "./contract-schema";
import { OPERATION_ROLES } from "../lib/auth/policy";
import { buildWorld, call, d, tenantIds, tenantSnapshot, uniq, type Handler, type TenantFx, type Who, type World } from "./helpers-api";

/* eslint-disable @typescript-eslint/no-explicit-any */

type Role = "owner" | "coach" | "customer";
interface Op { id: string; method: string; path: string; roles: string[]; success: number; schema: any; hasBody: boolean; responses: string[] }

const doc = yaml.load(readFileSync(join(__dirname, "../docs/api/openapi.yaml"), "utf8")) as any;
const OPS: Op[] = [];
for (const [path, item] of Object.entries<any>(doc.paths)) {
  for (const [method, op] of Object.entries<any>(item)) {
    if (!op?.operationId) continue;
    const codes = Object.keys(op.responses);
    const success = Number(codes.find((c) => c.startsWith("2")));
    OPS.push({
      id: op.operationId,
      method: method.toUpperCase(),
      path,
      roles: op["x-roles"],
      success,
      schema: op.responses[String(success)]?.content?.["application/json"]?.schema ?? null,
      hasBody: Boolean(op.requestBody),
      responses: codes,
    });
  }
}
const opById = new Map(OPS.map((o) => [o.id, o]));

// Route handlers, discovered from the file system by contract path.
const routeModules = import.meta.glob("../app/api/v1/**/route.ts", { eager: true }) as Record<string, Record<string, Handler>>;
const routeKey = (path: string) => `../app/api/v1${path.replace(/\{(\w+)\}/g, "[$1]")}/route.ts`;
const handlerOf = (op: Op): Handler | undefined => routeModules[routeKey(op.path)]?.[op.method];

/** Contract operations that have no route in this POC (phone OTP is out of scope, PLAN-POC section 8). */
const NOT_IMPLEMENTED = ["requestOtp", "verifyOtp"];
/** Public operations: tested by their own cases below, not by the role matrix. */
const PUBLIC = ["exchangeMagicLink", "refreshSession", "getTenantTheme"];

type Row = "own" | "open";
interface Req { params?: Record<string, string>; query?: string; body?: unknown; form?: FormData }
interface Case {
  /** Row rule for a coach / customer who is allowed by role: "own" = only their own rows (else 403), "open" = any (lists are filtered). */
  rows: Row;
  /** True when the request names ids of the tenant (so another tenant's actor gets 404). False for lists and tenant-wide writes. */
  scoped: boolean;
  /** Expected status override for the actor where it differs from the default rule. */
  exp?: Partial<Record<Who, number>>;
  /** Another tenant's actor on this tenant's ids (default 404). */
  foreign?: number;
  /** Mint a throw-away session per call (sign-out revokes the token). */
  mint?: boolean;
  build(c: TenantFx, who: Who): Promise<Req> | Req;
}

let seq = 0;
const planBody = (c: TenantFx, title: string) => ({
  title,
  cadence: "daily",
  days: [{ dayIndex: 1, title: "Daily", items: [{ exerciseId: c.ids.exA, position: 1, sets: 3, reps: 10 }, { exerciseId: c.ids.exB, position: 2, durationSeconds: 45 }] }],
});
const kid = (c: TenantFx): Req => ({ params: { memberId: c.ids.kid } });
const read = (build: (c: TenantFx) => Req | Promise<Req> = () => ({}), extra: Partial<Case> = {}): Case => ({ rows: "open", scoped: false, build, ...extra });
const memberRead = (): Case => ({ rows: "own", scoped: true, build: kid });

const CASES: Record<string, Case> = {
  signOut: { rows: "open", scoped: false, mint: true, build: () => ({}) },
  getMe: read(),
  getCurrentTenant: read(),
  updateTenantTheme: read(() => ({ body: { displayName: "QA Display", primaryColor: "#112233", secondaryColor: "#223344" } })),
  listMembers: read(),
  getMember: memberRead(),
  createMemberMagicLink: memberRead(),
  importMembersCsv: read(() => {
    const form = new FormData();
    form.set("file", new File([`name\nQA Import ${uniq()}\n`], "members.csv", { type: "text/csv" }));
    return { form };
  }),
  listVenues: read(),
  listBatches: read(),
  listSessions: read(),
  createSession: {
    rows: "own",
    scoped: true,
    build: (c) => {
      const start = Date.now() + (40 + ++seq) * 86_400_000;
      return { body: { batchId: c.ids.batch1, startsAt: new Date(start).toISOString(), endsAt: new Date(start + 3_600_000).toISOString() } };
    },
  },
  updateTenantSettings: read(() => ({ body: { waitlistEnabled: true } })),
  listExercises: read(),
  getExercise: { rows: "open", scoped: true, build: (c) => ({ params: { exerciseId: c.ids.exA } }) },
  listCoaches: read(),
  getCoachStats: { rows: "own", scoped: true, build: (c) => ({ params: { coachId: c.user.coach } }) },
  listCoachAvailability: { rows: "own", scoped: true, build: (c) => ({ params: { coachId: c.user.coach } }) },
  replaceCoachAvailability: { rows: "own", scoped: true, build: (c) => ({ params: { coachId: c.user.coach }, body: { slots: [{ weekday: 1, startTime: "06:00", endTime: "09:00" }] } }) },
  listWorkoutPlans: read(),
  createWorkoutPlan: { rows: "open", scoped: true, foreign: 400, build: (c) => ({ body: planBody(c, `Plan ${uniq()}`) }) },
  getWorkoutPlan: { rows: "own", scoped: true, build: (c) => ({ params: { planId: c.ids.plan } }) },
  updateWorkoutPlan: { rows: "own", scoped: true, build: async (c) => ({ params: { planId: (await c.fresh.plan()).id }, body: { ...planBody(c, `Edited ${uniq()}`), expectedVersion: 1 } }) },
  archiveWorkoutPlan: { rows: "own", scoped: true, build: async (c) => ({ params: { planId: (await c.fresh.plan()).id } }) },
  listPlanAssignments: read(),
  createPlanAssignments: { rows: "own", scoped: true, build: async (c) => ({ body: { planId: (await c.fresh.plan()).id, memberIds: [c.ids.kid], startsOn: d(0) } }) },
  updatePlanAssignment: { rows: "own", scoped: true, build: (c) => ({ params: { assignmentId: c.ids.assignment }, body: { note: "QA note" } }) },
  getMemberSchedule: memberRead(),
  listWorkoutLogs: memberRead(),
  recordWorkoutLog: {
    rows: "own",
    scoped: true,
    build: (c) => ({ body: { clientId: `qa-${uniq()}`, assignmentId: c.ids.assignment, planItemId: c.ids.planItem, scheduledFor: d(0), action: "start" } }),
  },
  getMemberStats: memberRead(),
  listGoals: memberRead(),
  createGoal: { rows: "own", scoped: true, build: (c) => ({ params: { memberId: c.ids.kid }, body: { title: "QA goal", metric: "custom", startValue: 0, targetValue: 5 } }) },
  updateGoal: { rows: "own", scoped: true, build: (c) => ({ params: { goalId: c.ids.goal }, body: { title: `Renamed ${uniq()}` } }) },
  addGoalCheckIn: { rows: "own", scoped: true, build: (c) => ({ params: { goalId: c.ids.goal }, body: { value: 3 } }) },
  listMemberUpdates: memberRead(),
  markMemberUpdatesRead: { rows: "own", scoped: true, build: (c) => ({ params: { memberId: c.ids.kid }, body: { upTo: new Date().toISOString() } }) },
  getSession: { rows: "own", scoped: true, build: (c) => ({ params: { sessionId: c.ids.sessionFuture } }) },
  updateSession: { rows: "own", scoped: true, build: (c) => ({ params: { sessionId: c.ids.sessionFuture }, body: { coachNote: "QA note" } }) },
  recordAttendance: {
    rows: "own",
    scoped: true,
    build: (c) => ({ params: { sessionId: c.ids.sessionPast }, body: { entries: [{ memberId: c.ids.kid, status: "present", clientId: `qa-${uniq()}` }] } }),
  },
  bookSession: { rows: "own", scoped: true, build: async (c) => ({ params: { sessionId: await c.fresh.futureSession() }, body: { memberId: c.ids.kid } }) },
  cancelBooking: { rows: "own", scoped: true, build: async (c) => ({ params: { bookingId: await c.fresh.booking() } }) },
  getOwnerOverview: read(),
  getOwnerTrends: read(),
  getCoachWorkload: read(),
  getFeeStats: read(),
  getOwnerInsights: read(),
  listHolidays: read(),
  createHoliday: read(() => ({ body: { date: d(400 + ++seq), name: `QA Closure ${uniq()}` } })),
  deleteHoliday: { rows: "open", scoped: true, build: async (c) => ({ params: { holidayId: await c.fresh.holiday() } }) },
  listExcusedAbsences: memberRead(),
  createExcusedAbsence: { rows: "own", scoped: true, build: (c) => ({ params: { memberId: c.ids.kid }, body: { fromDate: d(20 + ++seq), reason: "travel", note: "QA trip" } }) },
  cancelExcusedAbsence: { rows: "own", scoped: true, build: async (c) => ({ params: { absenceId: await c.fresh.absence() } }) },
};

const roleOf = (w: Who): Role => (w === "owner" ? "owner" : w === "coach" || w === "coachX" ? "coach" : "customer");

function expected(op: Op, cs: Case, who: Who): number {
  if (cs.exp?.[who] !== undefined) return cs.exp[who]!;
  if (!op.roles.includes(roleOf(who))) return 403;
  if ((who === "coachX" || who === "stranger") && cs.rows === "own") return 403;
  return op.success;
}

const fill = (path: string, params: Record<string, string> = {}) => path.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? `missing-${k}`);

describe("contract coverage: every operation is in the matrix", () => {
  it("parses at least 55 operations from the contract", () => {
    expect(OPS.length).toBeGreaterThanOrEqual(55);
  });

  it("every operation is a matrix case, a public case or a documented gap; nothing stale", () => {
    const known = new Set([...Object.keys(CASES), ...PUBLIC, ...NOT_IMPLEMENTED]);
    expect(OPS.filter((o) => !known.has(o.id)).map((o) => o.id), "new operation without a test case").toEqual([]);
    expect([...known].filter((id) => !opById.has(id)), "case for an operation no longer in the contract").toEqual([]);
  });

  it("every contract operation has a route handler, except the documented OTP gap", () => {
    expect(OPS.filter((o) => !handlerOf(o) && !NOT_IMPLEMENTED.includes(o.id)).map((o) => `${o.method} ${o.path}`)).toEqual([]);
    for (const id of NOT_IMPLEMENTED) expect(handlerOf(opById.get(id)!), `${id} now has a route: add a case`).toBeUndefined();
  });

  it("every route file maps to a contract operation (no undocumented endpoints), apart from dev and health", () => {
    const contract = new Set(OPS.map((o) => routeKey(o.path)));
    const extra = Object.keys(routeModules).filter((k) => !contract.has(k) && !/\/dev\//.test(k));
    expect(extra).toEqual([]);
  });

  it("matrix roles come from the contract and match lib/auth/policy.ts and the PLAN-POC permission matrix", () => {
    const policy = OPERATION_ROLES as Record<string, readonly string[] | "public">;
    for (const o of OPS) {
      const rule = policy[o.id];
      if (o.roles.includes("public")) expect(rule, o.id).toBe("public");
      else expect([...(rule as readonly string[])].sort(), o.id).toEqual([...o.roles].sort());
    }
    // PLAN-POC section 3, transcribed: o = owner, c = coach, u = customer.
    const plan: Record<string, string> = {
      updateTenantSettings: "o", listExercises: "ocu", getExercise: "ocu", listCoaches: "o", getCoachStats: "oc", listCoachAvailability: "oc",
      replaceCoachAvailability: "oc", listWorkoutPlans: "oc", createWorkoutPlan: "oc", getWorkoutPlan: "ocu", updateWorkoutPlan: "oc",
      archiveWorkoutPlan: "oc", listPlanAssignments: "ocu", createPlanAssignments: "oc", updatePlanAssignment: "oc", getMemberSchedule: "ocu",
      listWorkoutLogs: "ocu", recordWorkoutLog: "cu", getMemberStats: "ocu", listGoals: "ocu", createGoal: "oc", updateGoal: "oc",
      addGoalCheckIn: "oc", listMemberUpdates: "ocu", markMemberUpdatesRead: "u", createSession: "oc", getSession: "ocu", updateSession: "oc",
      recordAttendance: "oc", bookSession: "ocu", cancelBooking: "ocu", getOwnerOverview: "o", getOwnerTrends: "o", getCoachWorkload: "o",
      getFeeStats: "o", getOwnerInsights: "o", listHolidays: "o", createHoliday: "o", deleteHoliday: "o",
      getFeeStats: "o", getOwnerInsights: "o", listExcusedAbsences: "ocu", createExcusedAbsence: "u", cancelExcusedAbsence: "u",
    };
    for (const [id, code] of Object.entries(plan)) {
      const want = [...code].map((ch) => ({ o: "owner", c: "coach", u: "customer" })[ch as "o"]).sort();
      expect([...opById.get(id)!.roles].sort(), id).toEqual(want);
    }
  });
});

describe("role matrix and tenant isolation per operation (local Postgres)", () => {
  let prisma: PrismaClient | null = null;
  let world: World;

  beforeAll(async () => {
    prisma = await tryConnect();
    if (!prisma) return;
    world = await buildWorld(prisma, "qa74");
  });
  afterAll(async () => {
    if (!prisma) return;
    await world?.cleanup();
    await prisma.$disconnect();
  });

  const tokenFor = async (c: TenantFx, who: Who, cs: Case) => (cs.mint ? c.fresh.token(who) : c.token[who]);

  async function send(op: Op, req: Req, token: string | undefined) {
    const h = handlerOf(op)!;
    const q = req.query ? `?${req.query}` : "";
    const path = `${fill(op.path, req.params)}${q}`;
    const r = await call(h, op.method, path, token, { body: req.body, params: req.params, form: req.form });
    return { ...r, request: `${path} ${req.body ? JSON.stringify(req.body) : ""}` };
  }

  function checkShape(op: Op, status: number, body: unknown, label: string) {
    if (status === op.success) {
      if (status === 204) expect(body, label).toBeNull();
      else if (op.schema) expect(validate(body, op.schema), `${label} contract shape`).toEqual([]);
    } else {
      expect(validateSchemaName(body, "Error"), `${label} error shape (${status})`).toEqual([]);
    }
    if (status >= 400) expect(op.responses, `${label}: contract does not list ${status}`).toContain(String(status));
  }

  const matrixOps = OPS.filter((o) => CASES[o.id]);

  for (const op of matrixOps) it(op.id, async (ctx) => {
    if (!prisma) return ctx.skip();
    const db = prisma;
    const cs = CASES[op.id];
    const { A, B } = world;
    const seen: { tenant: "A" | "B"; text: string; request: string; label: string }[] = [];
    const failures: string[] = [];
    const check = (cond: boolean, msg: string) => {
      if (!cond) failures.push(msg);
    };

    // Phase 1: tenant A actors on tenant A's rows.
    const phase1: Who[] = ["owner", "coach", "coachX", "parent", "stranger"];
    // Denied actors first, so single-use state is intact for the successful ones.
    const order = [...phase1];
    order.sort((a, b) => Number(expected(op, cs, a) === op.success) - Number(expected(op, cs, b) === op.success));

    // anonymous
    {
      const r = await send(op, await cs.build(A, "owner"), undefined);
      check(r.status === 401, `anonymous: expected 401 got ${r.status}`);
      checkShape(op, r.status, r.body, "anonymous");
    }

    // Prepare the cross-tenant requests before snapshotting (fresh rows are created in B here).
    const foreignReqs: [Who, Req][] = [];
    if (cs.scoped) for (const who of ["owner", "coach", "parent"] as Who[]) foreignReqs.push([who, await cs.build(B, who)]);
    const bBefore = await tenantSnapshot(db, B.id);
    for (const who of order) {
      const want = expected(op, cs, who);
      const req = await cs.build(A, who);
      const r = await send(op, req, await tokenFor(A, who, cs));
      check(r.status === want, `${who} on own tenant: expected ${want} got ${r.status} ${r.text.slice(0, 160)}`);
      checkShape(op, r.status, r.body, who);
      seen.push({ tenant: "A", text: r.text, request: r.request, label: who });
    }
    // Phase 2: tenant A actors on tenant B's ids (scoped operations only): never data, never a write.
    for (const [who, req] of foreignReqs) {
      const want = op.roles.includes(roleOf(who)) ? (cs.foreign ?? 404) : 403;
      const r = await send(op, req, await tokenFor(A, who, cs));
      check(r.status === want, `${who} of A on B's ids: expected ${want} got ${r.status} ${r.text.slice(0, 160)}`);
      checkShape(op, r.status, r.body, `${who}->B`);
      seen.push({ tenant: "A", text: r.text, request: r.request, label: `${who}->B` });
    }
    const bAfter = await tenantSnapshot(db, B.id);
    check(JSON.stringify(bAfter) === JSON.stringify(bBefore), "tenant A actors changed rows in tenant B");

    // Phase 3: tenant B actors. Scoped operations target A's ids; tenant-wide ones run in B itself.
    const bActors: [Who, Who][] = [["owner", "owner"], ["coach", "coach"], ["parent", "parent"]];
    const bReqs: [Who, Req][] = [];
    for (const [who] of bActors) bReqs.push([who, await cs.build(cs.scoped ? A : B, who)]);
    const aBefore = await tenantSnapshot(db, A.id);
    for (const [who, req] of bReqs) {
      const allowed = op.roles.includes(roleOf(who));
      const want = !allowed ? 403 : cs.scoped ? (cs.foreign ?? 404) : (cs.exp?.[who] ?? op.success);
      const r = await send(op, req, await tokenFor(B, who, cs));
      check(r.status === want, `${who} of B: expected ${want} got ${r.status} ${r.text.slice(0, 160)}`);
      checkShape(op, r.status, r.body, `${who}B`);
      seen.push({ tenant: "B", text: r.text, request: r.request, label: `${who}B` });
    }
    const aAfter = await tenantSnapshot(db, A.id);
    check(JSON.stringify(aAfter) === JSON.stringify(aBefore), "tenant B actors changed rows in tenant A");

    // No id of the other tenant in any response body.
    const idsA = await tenantIds(db, A.id);
    const idsB = await tenantIds(db, B.id);
    for (const s of seen) {
      const foreign = s.tenant === "A" ? idsB : idsA;
      // A actor on B's ids legitimately names B's ids in the request; those are not leaks.
      for (const fid of foreign) {
        if (s.text.includes(fid) && !s.request.includes(fid)) failures.push(`${s.label}: response contains another tenant's id ${fid}`);
      }
    }

    expect(failures, `${op.method} ${op.path}`).toEqual([]);
  }, 60_000);

  it("a customer or coach without a view never receives rows of someone else in a list (filtered, not forbidden)", async (ctx) => {
    if (!prisma) return ctx.skip();
    const { A } = world;
    const memberIdsIn = (b: any) => (b.items ?? []).map((m: any) => m.memberId ?? m.id);
    const members = await send(opById.get("listMembers")!, {}, A.token.coachX);
    expect(members.status).toBe(200);
    expect(members.body.items.map((m: any) => m.id)).toEqual([A.ids.m2]);
    const assignments = await send(opById.get("listPlanAssignments")!, {}, A.token.stranger);
    expect(assignments.status).toBe(200);
    expect(memberIdsIn(assignments.body)).toEqual([]);
    const own = await send(opById.get("listPlanAssignments")!, {}, A.token.parent);
    expect([...new Set(memberIdsIn(own.body))]).toEqual([A.ids.kid]);
    const plans = await send(opById.get("listWorkoutPlans")!, {}, A.token.coachX);
    expect(plans.body.items.map((p: any) => p.id)).not.toContain(A.ids.plan);
    const sessions = await send(opById.get("listSessions")!, { query: "limit=100" }, A.token.stranger);
    const ids = sessions.body.items.map((s: any) => s.id);
    expect(ids).not.toContain(A.ids.sessionFuture);
  });

  it("customers get no roster in getSession, and no other member's name", async (ctx) => {
    if (!prisma) return ctx.skip();
    const { A } = world;
    const op = opById.get("getSession")!;
    const asParent = await send(op, { params: { sessionId: A.ids.sessionFuture } }, A.token.parent);
    expect(asParent.status).toBe(200);
    expect(asParent.body.roster).toBeUndefined();
    expect(asParent.text).not.toContain("QA Adult A");
    const asCoach = await send(op, { params: { sessionId: A.ids.sessionFuture } }, A.token.coach);
    expect(asCoach.body.roster.map((r: any) => r.memberId)).toEqual([A.ids.kid]);
  });

  it("public operations: theme is public by slug, exchange and refresh reject bad credentials", async (ctx) => {
    if (!prisma) return ctx.skip();
    const { A, B } = world;
    const theme = opById.get("getTenantTheme")!;
    for (const token of [undefined, A.token.owner, B.token.coach]) {
      const r = await send(theme, { params: { tenantSlug: A.slug } }, token);
      expect(r.status).toBe(200);
      expect(validate(r.body, theme.schema)).toEqual([]);
      expect(r.text).not.toContain(B.id);
    }
    expect((await send(theme, { params: { tenantSlug: `nope-${uniq()}` } }, undefined)).status).toBe(404);
    for (const id of ["exchangeMagicLink", "refreshSession"]) {
      const op = opById.get(id)!;
      for (const token of [undefined, A.token.owner]) {
        const r = await send(op, { body: id === "exchangeMagicLink" ? { token: "garbage-token-value" } : { refreshToken: "garbage-token-value" } }, token);
        expect(r.status, id).toBe(401);
        expect(validateSchemaName(r.body, "Error")).toEqual([]);
      }
    }
  });
});
