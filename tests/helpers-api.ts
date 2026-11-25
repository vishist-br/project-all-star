/**
 * Shared fixtures for the STAR-74 API suites (api-matrix, api-dataflow). Builds two isolated
 * fake tenants (A and B) with the same shape, real auth sessions per actor, and "fresh" creators
 * for single-use rows (a plan to archive, a booking to cancel). All data is synthetic.
 */
import type { PrismaClient } from "@prisma/client";
import { hashToken } from "../lib/auth/tokens";
import { POST as createPlanRoute } from "../app/api/v1/workout-plans/route";
import { POST as createAssignmentsRoute } from "../app/api/v1/plan-assignments/route";
import { POST as createGoalRoute } from "../app/api/v1/members/[memberId]/goals/route";
import { POST as bookRoute } from "../app/api/v1/sessions/[sessionId]/bookings/route";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Handler = (...args: any[]) => Promise<Response>;

export const dayMs = 86_400_000;
export const todayStr = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
/** Tenant (IST) calendar date n days from today. */
export const d = (n: number) => new Date(new Date(`${todayStr()}T00:00:00Z`).getTime() + n * dayMs).toISOString().slice(0, 10);

export type Who = "owner" | "coach" | "coachX" | "parent" | "stranger";
export const WHO: Who[] = ["owner", "coach", "coachX", "parent", "stranger"];
const ROLE: Record<Who, "OWNER" | "COACH" | "CUSTOMER"> = { owner: "OWNER", coach: "COACH", coachX: "COACH", parent: "CUSTOMER", stranger: "CUSTOMER" };

export interface TenantFx {
  key: "A" | "B";
  id: string;
  slug: string;
  user: Record<Who, string>;
  token: Record<Who, string>;
  ids: Record<string, string>;
  /** Fresh single-use rows, created through the real API or directly. */
  fresh: {
    plan(): Promise<{ id: string; itemId: string; dayId: string }>;
    futureSession(): Promise<string>;
    booking(): Promise<string>;
    holiday(): Promise<string>;
    /** A declared absence of the parent's child (STAR-95), created directly. */
    absence(): Promise<string>;
    /** An unverified credential of the tenant coach (STAR-97), created directly. */
    credential(): Promise<string>;
    /** A live shared progress-card link of the parent's child (STAR-96), created directly; returns the row id. */
    link(): Promise<string>;
    token(who: Who): Promise<string>;
  };
}

export interface World {
  A: TenantFx;
  B: TenantFx;
  sessionIds: string[];
  cleanup(): Promise<void>;
}

export async function call(handler: Handler, method: string, path: string, token: string | undefined, opts: { body?: unknown; params?: Record<string, string>; form?: FormData } = {}) {
  const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const res = await handler(new Request(`http://localhost/api/v1${path}`, { method, headers, ...(body !== undefined ? { body } : {}) }), { params: Promise.resolve(opts.params ?? {}) });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json, text };
}

let counter = 0;
let holidaySeq = 0;
export const uniq =() => `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export async function buildWorld(prisma: PrismaClient, tag: string): Promise<World> {
  const sfx = uniq();
  const sessionIds: string[] = [];
  const tenantIds: string[] = [];
  let slot = 0; // keeps (batch, startsAt) unique

  async function mint(userId: string, tenantId: string) {
    const token = `${tag}-${uniq()}-${Math.random().toString(36).slice(2)}`;
    const s = await prisma.authSession.create({
      data: { tenantId, userId, accessHash: hashToken(token), refreshHash: hashToken(`r-${token}`), accessExpiresAt: new Date(Date.now() + 3_600_000), refreshExpiresAt: new Date(Date.now() + 7_200_000) },
    });
    sessionIds.push(s.id);
    return token;
  }

  async function tenant(key: "A" | "B"): Promise<TenantFx> {
    const t = await prisma.tenant.create({ data: { slug: `${tag}-${key.toLowerCase()}-${sfx}`, name: `QA ${tag} ${key}` } });
    tenantIds.push(t.id);
    const user = {} as Record<Who, string>;
    const token = {} as Record<Who, string>;
    for (const w of WHO) {
      const u = await prisma.user.create({ data: { tenantId: t.id, role: ROLE[w], email: `${w}-${key}-${sfx}@qa.example.test`, name: `QA ${w} ${key}` } });
      user[w] = u.id;
      token[w] = await mint(u.id, t.id);
    }
    const ids: Record<string, string> = {};
    const venue = await prisma.venue.create({ data: { tenantId: t.id, name: `Hall ${key}` } });
    const sport = await prisma.sport.create({ data: { tenantId: t.id, slug: "karate", name: "Karate" } });
    ids.venue = venue.id;
    ids.sport = sport.id;
    const mkBatch = (coachId: string, name: string) =>
      prisma.batch.create({ data: { tenantId: t.id, venueId: venue.id, sportId: sport.id, coachId, name, kind: "GROUP_CLASS", capacity: 3, daysOfWeek: [1, 3], startTime: "17:00", endTime: "18:00" } });
    ids.batch1 = (await mkBatch(user.coach, `Batch one ${key}`)).id;
    ids.batch2 = (await mkBatch(user.coachX, `Batch two ${key}`)).id;
    const guardian = await prisma.guardian.create({ data: { tenantId: t.id, userId: user.parent, name: `QA Guardian ${key}` } });
    const kid = await prisma.member.create({ data: { tenantId: t.id, displayName: `QA Kid ${key}`, isMinor: true, guardianId: guardian.id, joinedOn: new Date(`${d(-60)}T00:00:00Z`) } });
    const m2 = await prisma.member.create({ data: { tenantId: t.id, displayName: `QA Adult ${key}`, userId: user.stranger, joinedOn: new Date(`${d(-60)}T00:00:00Z`) } });
    ids.kid = kid.id;
    ids.m2 = m2.id;
    for (const [batchId, memberId] of [[ids.batch1, kid.id], [ids.batch2, m2.id]]) {
      await prisma.batchMember.create({ data: { tenantId: t.id, batchId, memberId, joinedOn: new Date(`${d(-60)}T00:00:00Z`) } });
    }
    ids.exA = (await prisma.exercise.create({ data: { tenantId: t.id, source: "ORIGINAL", sourceId: `fk-${key}`, sportSlug: "karate", name: `Front kick ${key}`, licence: "Original (project)", primaryMuscles: ["quadriceps"], instructions: ["Kick"] } })).id;
    ids.exB = (await prisma.exercise.create({ data: { tenantId: t.id, source: "ORIGINAL", sourceId: `ph-${key}`, sportSlug: "general", name: `Plank hold ${key}`, licence: "Original (project)", primaryMuscles: ["abdominals"], instructions: ["Hold"] } })).id;

    const mkSession = async (batchId: string, coachId: string, startsAt: Date, extra: Record<string, unknown> = {}) => {
      const s = await prisma.session.create({ data: { tenantId: t.id, batchId, coachId, startsAt, endsAt: new Date(startsAt.getTime() + 3_600_000), ...extra } });
      return s.id;
    };
    const futureSession = () => mkSession(ids.batch1, user.coach, new Date(Date.now() + 3 * dayMs + 7 * 60_000 * ++slot));
    ids.sessionFuture = await futureSession();
    ids.sessionPast = await mkSession(ids.batch1, user.coach, new Date(Date.now() - 26 * 3_600_000));

    const planBody = (title: string) => ({
      title,
      cadence: "daily",
      days: [{ dayIndex: 1, title: "Daily", items: [{ exerciseId: ids.exA, position: 1, sets: 3, reps: 10 }, { exerciseId: ids.exB, position: 2, durationSeconds: 45 }] }],
    });
    const freshPlan = async () => {
      const r = await call(createPlanRoute, "POST", "/workout-plans", token.coach, { body: planBody(`Plan ${uniq()}`) });
      if (r.status !== 201) throw new Error(`fixture plan failed ${r.status} ${r.text}`);
      return { id: r.body.id as string, itemId: r.body.days[0].items[0].id as string, dayId: r.body.days[0].id as string };
    };
    const plan = await freshPlan();
    ids.plan = plan.id;
    ids.planItem = plan.itemId;
    ids.planDay = plan.dayId;
    const asg = await call(createAssignmentsRoute, "POST", "/plan-assignments", token.coach, { body: { planId: plan.id, memberIds: [kid.id], startsOn: d(-3) } });
    if (asg.status !== 201) throw new Error(`fixture assignment failed ${asg.status} ${asg.text}`);
    ids.assignment = asg.body.items[0].id;
    // Workout engine fixtures (STAR-107): a belt checklist, and a completed class with a published summary.
    const level = await prisma.level.create({ data: { tenantId: t.id, sportId: sport.id, name: `White ${key}`, rank: 1 } });
    const checklist = await prisma.skillChecklist.create({ data: { tenantId: t.id, sportId: sport.id, levelId: level.id, title: `Yellow belt skills ${key}`, sortOrder: 1 } });
    const skill = await prisma.skillItem.create({ data: { tenantId: t.id, checklistId: checklist.id, title: `Front stance ${key}`, sortOrder: 1 } });
    ids.level = level.id;
    ids.skillChecklist = checklist.id;
    ids.skillItem = skill.id;
    ids.sessionDone = await mkSession(ids.batch1, user.coach, new Date(Date.now() - 50 * 3_600_000), { status: "COMPLETED", completedAt: new Date(Date.now() - 49 * 3_600_000) });
    await prisma.attendance.create({ data: { tenantId: t.id, sessionId: ids.sessionDone, memberId: kid.id, status: "EXCUSED", reason: "ILLNESS", clientId: `fx-att-${key}-${sfx}`, markedById: user.coach } });
    await prisma.classSummary.create({ data: { tenantId: t.id, sessionId: ids.sessionDone, coachNote: "Fixture note", homePractice: "Fixture practice", publishedById: user.coach } });

    const goal = await call(createGoalRoute, "POST", "", token.coach, { params: { memberId: kid.id }, body: { title: "Fixture goal", metric: "custom", startValue: 0, targetValue: 10 } });
    if (goal.status !== 201) throw new Error(`fixture goal failed ${goal.status} ${goal.text}`);
    ids.goal = goal.body.id;

    return {
      key,
      id: t.id,
      slug: t.slug,
      user,
      token,
      ids,
      fresh: {
        plan: freshPlan,
        futureSession,
        async credential() {
          const row = await prisma.coachCredential.create({ data: { tenantId: t.id, coachId: user.coach, title: `QA fixture credential ${uniq()}`, issuer: "QA Board", year: 2021 } });
          return row.id;
        },
        async absence() {
          const row = await prisma.excusedAbsence.create({
            data: { tenantId: t.id, memberId: kid.id, fromDate: new Date(`${d(30 + ++slot)}T00:00:00Z`), toDate: new Date(`${d(30 + slot)}T00:00:00Z`), reason: "EXAM", createdById: user.parent },
          });
          return row.id;
        },
        token: (who: Who) => mint(user[who], t.id),
        async link() {
          const row = await prisma.progressCardLink.create({
            data: { tenantId: t.id, memberId: kid.id, weekStart: new Date(`${d(-7)}T00:00:00Z`), tokenHash: hashToken(`fx-${uniq()}`), createdById: user.parent, expiresAt: new Date(Date.now() + 86_400_000) },
          });
          return row.id;
        },
        async holiday() {
          const row = await prisma.holiday.create({ data: { tenantId: t.id, date: new Date(`${d(300 + ++holidaySeq)}T00:00:00Z`), name: "QA fixture closure" } });
          return row.id;
        },
        async booking() {
          const sid = await futureSession();
          const r = await call(bookRoute, "POST", `/sessions/${sid}/bookings`, token.owner, { body: { memberId: kid.id }, params: { sessionId: sid } });
          if (r.status !== 201) throw new Error(`fixture booking failed ${r.status} ${r.text}`);
          return r.body.id as string;
        },
      },
    };
  }

  const A = await tenant("A");
  const B = await tenant("B");

  return {
    A,
    B,
    sessionIds,
    async cleanup() {
      await prisma.authSession.deleteMany({ where: { id: { in: sessionIds } } });
      for (const tenantId of tenantIds) {
        await prisma.classSummaryShare.deleteMany({ where: { tenantId } });
        await prisma.classSummary.deleteMany({ where: { tenantId } });
        await prisma.workoutSet.deleteMany({ where: { tenantId } });
        await prisma.skillSignOff.deleteMany({ where: { tenantId } });
        await prisma.excusedAbsence.deleteMany({ where: { tenantId } });
        await prisma.coachCredential.deleteMany({ where: { tenantId } });
        await prisma.progressCardLink.deleteMany({ where: { tenantId } });
        await prisma.progressNote.deleteMany({ where: { tenantId } });
        await prisma.memberUpdate.deleteMany({ where: { tenantId } });
        await prisma.sessionBooking.deleteMany({ where: { tenantId } });
        await prisma.workoutLog.deleteMany({ where: { tenantId } });
        await prisma.goalCheckIn.deleteMany({ where: { tenantId } }).catch(() => undefined);
        await prisma.planAssignment.deleteMany({ where: { tenantId } });
        await prisma.workoutPlan.deleteMany({ where: { tenantId } });
        await prisma.attendance.deleteMany({ where: { tenantId } });
        await prisma.session.deleteMany({ where: { tenantId } });
        await prisma.coachAvailability.deleteMany({ where: { tenantId } }).catch(() => undefined);
        await prisma.tenantSettings.deleteMany({ where: { tenantId } });
        await prisma.magicLink.deleteMany({ where: { tenantId } });
        await prisma.batch.deleteMany({ where: { tenantId } });
        await prisma.tenant.delete({ where: { id: tenantId } }).catch((e) => console.warn("cleanup tenant", e.code));
      }
    },
  };
}

const ID_MODELS = ["user", "member", "guardian", "venue", "sport", "batch", "session", "attendance", "workoutPlan", "planAssignment", "workoutLog", "goal", "sessionBooking", "memberUpdate", "exercise", "magicLink", "authSession", "coachAvailability", "tenantSettings", "holiday", "excusedAbsence", "coachCredential", "progressNote", "progressCardLink", "workoutSet", "classSummary", "classSummaryShare", "skillChecklist", "skillItem", "skillSignOff", "level"] as const;

/** All row ids of a tenant (for response leakage checks) and per-table counts (for write checks). */
export async function tenantIds(prisma: PrismaClient, tenantId: string): Promise<Set<string>> {
  const out = new Set<string>([tenantId]);
  for (const m of ID_MODELS) {
    try {
      const rows = await (prisma as any)[m].findMany({ where: { tenantId }, select: { id: true } });
      for (const r of rows) if (typeof r.id === "string" && r.id.length >= 12) out.add(r.id);
    } catch {
      /* model without id or tenantId */
    }
  }
  return out;
}

export async function tenantSnapshot(prisma: PrismaClient, tenantId: string): Promise<Record<string, unknown>> {
  const snap: Record<string, unknown> = {};
  for (const m of [...ID_MODELS, "batchMember", "goalCheckIn", "tenantTheme"]) {
    try {
      snap[m] = await (prisma as any)[m].count({ where: { tenantId } });
    } catch {
      /* skip */
    }
  }
  snap.settings = await prisma.tenantSettings.findUnique({ where: { tenantId } }).catch(() => null);
  snap.theme = await prisma.tenantTheme.findUnique({ where: { tenantId } }).catch(() => null);
  snap.sessionsRows = await prisma.session.findMany({ where: { tenantId }, orderBy: { id: "asc" } });
  snap.membersRows = await prisma.member.findMany({ where: { tenantId }, orderBy: { id: "asc" } });
  snap.plansRows = await prisma.workoutPlan.findMany({ where: { tenantId }, orderBy: { id: "asc" } });
  snap.assignmentRows = await prisma.planAssignment.findMany({ where: { tenantId }, orderBy: { id: "asc" } });
  snap.goalRows = await prisma.goal.findMany({ where: { tenantId }, orderBy: { id: "asc" } });
  snap.credentialRows = await prisma.coachCredential.findMany({ where: { tenantId }, orderBy: { id: "asc" } });
  snap.bookingRows = await prisma.sessionBooking.findMany({ where: { tenantId }, orderBy: { id: "asc" } });
  return JSON.parse(JSON.stringify(snap));
}
