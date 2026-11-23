/**
 * STAR-95: pre-declared excused absences. A member or parent declares a session or a date range
 * ahead of time; the coach sees the member pre-marked as EXCUSED on that session's roll call; an
 * excused absence never extends the member's timeline. Rules are unit tested; the API, tenant
 * isolation and the roll call run against the local Postgres with fake data.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { tryConnect } from "./helpers-db";
import { validateSchemaName } from "./contract-schema";
import { buildWorld, call, d, dayMs, type TenantFx, type World } from "./helpers-api";
import { ABSENCE_REASONS, MAX_RANGE_DAYS, covers, daysInRange, pickDeclaration, preMarkClientId, type Declaration } from "../lib/absences/rules";
import { extendsTimeline } from "../lib/api/attendance";
import { canComplete, markedRows, mergeRoster, summarize, type RosterRow } from "../lib/offline/rollcall";
import { GET as listRoute, POST as createRoute } from "../app/api/v1/members/[memberId]/excused-absences/route";
import { POST as cancelRoute } from "../app/api/v1/excused-absences/[absenceId]/cancel/route";
import { GET as sessionRoute } from "../app/api/v1/sessions/[sessionId]/route";
import { PUT as attendanceRoute } from "../app/api/v1/sessions/[sessionId]/attendance/route";

/* eslint-disable @typescript-eslint/no-explicit-any */

const decl = (o: Partial<Declaration> = {}): Declaration => ({
  id: "d1",
  fromDate: "2026-12-01",
  toDate: "2026-12-05",
  sessionId: null,
  reason: "exam",
  note: null,
  withdrawn: false,
  ...o,
});

describe("declared absence rules (pure)", () => {
  it("a range covers the sessions on its dates, both ends included, and nothing outside", () => {
    expect(covers(decl(), { id: "s", date: "2026-12-01" })).toBe(true);
    expect(covers(decl(), { id: "s", date: "2026-12-05" })).toBe(true);
    expect(covers(decl(), { id: "s", date: "2026-11-30" })).toBe(false);
    expect(covers(decl(), { id: "s", date: "2026-12-06" })).toBe(false);
  });

  it("a one-session declaration covers only that session, a withdrawn one nothing", () => {
    expect(covers(decl({ sessionId: "a" }), { id: "a", date: "2026-12-02" })).toBe(true);
    expect(covers(decl({ sessionId: "a" }), { id: "b", date: "2026-12-02" })).toBe(false);
    expect(covers(decl({ withdrawn: true }), { id: "s", date: "2026-12-02" })).toBe(false);
  });

  it("the session-specific declaration wins over a range", () => {
    const range = decl({ id: "a-range", reason: "travel" });
    const one = decl({ id: "z-one", sessionId: "s", reason: "illness" });
    expect(pickDeclaration([range, one], { id: "s", date: "2026-12-02" })?.reason).toBe("illness");
    expect(pickDeclaration([range], { id: "s", date: "2026-12-09" })).toBeNull();
  });

  it("counts days inclusively and builds a stable pre-mark client id within the 64 character limit", () => {
    expect(daysInRange("2026-12-01", "2026-12-01")).toBe(1);
    expect(daysInRange("2026-12-01", "2026-12-31")).toBe(31);
    const id = preMarkClientId("c".repeat(25), "s".repeat(25));
    expect(id.length).toBeLessThanOrEqual(64);
    expect(id.length).toBeGreaterThanOrEqual(8);
    expect(id).toBe(preMarkClientId("c".repeat(25), "s".repeat(25)));
    expect(MAX_RANGE_DAYS).toBe(60);
    expect([...ABSENCE_REASONS]).toEqual(["exam", "illness", "festival", "travel"]);
  });

  it("only a plain absence extends the timeline: a declared (excused) absence never does", () => {
    expect(extendsTimeline("ABSENT", false)).toBe(true);
    expect(extendsTimeline("EXCUSED", false)).toBe(false);
    expect(extendsTimeline("EXCUSED", true)).toBe(false);
    expect(extendsTimeline("PRESENT", false)).toBe(false);
    expect(extendsTimeline("ABSENT", true)).toBe(false);
  });

  it("a pre-marked roster row counts as marked on the roll call and can be completed", () => {
    const roster: RosterRow[] = [
      { memberId: "m1", memberName: "A", source: "enrolled", attendance: "excused", excusedReason: "exam", note: null, attendanceClientId: preMarkClientId("dec1", "sess1"), preMarked: true, declaredReason: "exam", declaredNote: null },
      { memberId: "m2", memberName: "B", source: "enrolled", attendance: "not_marked", excusedReason: null, note: null, attendanceClientId: null },
    ];
    const rows = mergeRoster(roster, "sess1", []);
    expect(summarize(rows)).toEqual({ present: 0, absent: 0, excused: 1, notMarked: 1 });
    expect(markedRows(rows).map((r) => r.memberId)).toEqual(["m1"]);
    expect(canComplete(rows)).toBe("ok");
    // The coach taps the pre-marked row (the member came after all): the queued mark wins.
    const tapped = mergeRoster(roster, "sess1", [{ clientId: "tap-0001-abcd", sessionId: "sess1", memberId: "m1", status: "present", reason: null, note: null, markedAt: new Date().toISOString(), state: "queued" } as any]);
    expect(tapped[0].attendance).toBe("present");
  });
});

describe("declared absences: API, isolation and roll call (local Postgres, own data)", () => {
  let prisma: PrismaClient | null = null;
  let world: World;
  let A: TenantFx;
  let B: TenantFx;

  beforeAll(async () => {
    prisma = await tryConnect();
    if (!prisma) return;
    world = await buildWorld(prisma, "qa95");
    A = world.A;
    B = world.B;
  });
  afterAll(async () => {
    if (!prisma) return;
    await world?.cleanup();
    await prisma.$disconnect();
  });

  const declare = (c: TenantFx, who: "parent" | "stranger" | "coach" | "owner", memberId: string, body: unknown) =>
    call(createRoute, "POST", `/members/${memberId}/excused-absences`, c.token[who], { body, params: { memberId } });
  const list = (c: TenantFx, who: "parent" | "stranger" | "coach" | "owner", memberId: string, q = "") =>
    call(listRoute, "GET", `/members/${memberId}/excused-absences${q}`, c.token[who], { params: { memberId } });
  const withdraw = (c: TenantFx, who: "parent" | "stranger" | "coach", id: string) =>
    call(cancelRoute, "POST", `/excused-absences/${id}/cancel`, c.token[who], { params: { absenceId: id } });
  const detail = (c: TenantFx, who: "coach" | "parent", sessionId: string) =>
    call(sessionRoute, "GET", `/sessions/${sessionId}`, c.token[who], { params: { sessionId } });
  const rosterRow = (body: any, memberId: string) => body.roster.find((r: any) => r.memberId === memberId);

  it("a parent declares one upcoming session; the response matches the contract; the list shows it", async (ctx) => {
    if (!prisma) return ctx.skip();
    const sid = await A.fresh.futureSession();
    const r = await declare(A, "parent", A.ids.kid, { sessionId: sid, reason: "illness", note: "Fever, resting" });
    expect(r.status).toBe(201);
    expect(validateSchemaName(r.body, "ExcusedAbsence")).toEqual([]);
    expect(r.body).toMatchObject({ memberId: A.ids.kid, sessionId: sid, reason: "illness", status: "active", note: "Fever, resting" });
    expect(r.body.fromDate).toBe(r.body.toDate);
    const l = await list(A, "parent", A.ids.kid);
    expect(l.status).toBe(200);
    expect(l.body.items.map((x: any) => x.id)).toContain(r.body.id);
  });

  it("the coach sees the member pre-marked as EXCUSED with the reason on the roll call; nobody else is touched", async (ctx) => {
    if (!prisma) return ctx.skip();
    const sid = await A.fresh.futureSession();
    const r = await declare(A, "parent", A.ids.kid, { sessionId: sid, reason: "exam", note: "Board exam" });
    expect(r.status).toBe(201);
    const s = await detail(A, "coach", sid);
    expect(s.status).toBe(200);
    expect(rosterRow(s.body, A.ids.kid)).toMatchObject({
      attendance: "excused",
      excusedReason: "exam",
      preMarked: true,
      declaredReason: "exam",
      declaredNote: "Board exam",
    });
    expect(rosterRow(s.body, A.ids.kid).attendanceClientId).toBe(preMarkClientId(r.body.id, sid));
    // Nothing is stored as attendance until the coach completes the roll call, and the summary only counts real marks.
    expect(await prisma.attendance.count({ where: { sessionId: sid } })).toBe(0);
    expect(s.body.attendanceSummary).toBeNull();
    // The parent's own view does not turn a declaration into an attendance record.
    const mine = await detail(A, "parent", sid);
    expect(mine.body.myAttendance).toEqual([{ memberId: A.ids.kid, attendance: "not_marked" }]);
  });

  it("a date range pre-marks every session on those dates; a session outside the range stays unmarked", async (ctx) => {
    if (!prisma) return ctx.skip();
    const inside = await A.fresh.futureSession(); // 3 days ahead
    const day = new Date(Date.now() + 3 * dayMs + 330 * 60_000).toISOString().slice(0, 10);
    const r = await declare(A, "parent", A.ids.kid, { fromDate: day, toDate: day, reason: "festival" });
    expect(r.status).toBe(201);
    expect(rosterRow((await detail(A, "coach", inside)).body, A.ids.kid)).toMatchObject({ attendance: "excused", excusedReason: "festival", preMarked: true });
    const outside = await prisma.session.create({
      data: { tenantId: A.id, batchId: A.ids.batch1, coachId: A.user.coach, startsAt: new Date(Date.now() + 9 * dayMs + 1000 * Math.floor(Math.random() * 1e3)), endsAt: new Date(Date.now() + 9 * dayMs + 3_700_000) },
    });
    expect(rosterRow((await detail(A, "coach", outside.id)).body, A.ids.kid)).toMatchObject({ attendance: "not_marked", preMarked: false, declaredReason: null });
    expect((await withdraw(A, "parent", r.body.id)).status).toBe(200); // keep later tests independent
  });

  it("withdrawing removes the pre-mark (and withdrawing twice is safe)", async (ctx) => {
    if (!prisma) return ctx.skip();
    const sid = await A.fresh.futureSession();
    const r = await declare(A, "parent", A.ids.kid, { sessionId: sid, reason: "travel" });
    const w = await withdraw(A, "parent", r.body.id);
    expect(w.status).toBe(200);
    expect(w.body).toMatchObject({ status: "withdrawn" });
    expect((await withdraw(A, "parent", r.body.id)).status).toBe(200);
    expect(rosterRow((await detail(A, "coach", sid)).body, A.ids.kid)).toMatchObject({ attendance: "not_marked", preMarked: false });
    expect((await list(A, "parent", A.ids.kid)).body.items.map((x: any) => x.id)).not.toContain(r.body.id);
    expect((await list(A, "parent", A.ids.kid, "?status=all")).body.items.map((x: any) => x.id)).toContain(r.body.id);
  });

  it("completing the roll call turns a pre-declared member into a real EXCUSED row that does not extend the timeline", async (ctx) => {
    if (!prisma) return ctx.skip();
    const start = new Date(Date.now() - 3 * 3_600_000);
    const past = await prisma.session.create({ data: { tenantId: A.id, batchId: A.ids.batch1, coachId: A.user.coach, startsAt: start, endsAt: new Date(start.getTime() + 3_600_000) } });
    const day = new Date(start.getTime() + 330 * 60_000).toISOString().slice(0, 10);
    // The API refuses past dates, so a declaration that was made earlier is written directly.
    const decl = await prisma.excusedAbsence.create({
      data: { tenantId: A.id, memberId: A.ids.kid, fromDate: new Date(`${day}T00:00:00Z`), toDate: new Date(`${day}T00:00:00Z`), reason: "EXAM", createdById: A.user.parent },
    });
    const row = rosterRow((await detail(A, "coach", past.id)).body, A.ids.kid);
    expect(row).toMatchObject({ attendance: "excused", preMarked: true });
    // The coach marks someone else and completes; the declared member is not left unmarked.
    const done = await call(attendanceRoute, "PUT", `/sessions/${past.id}/attendance`, A.token.coach, {
      params: { sessionId: past.id },
      body: { complete: true, entries: [{ memberId: A.ids.m2, status: "present", clientId: `qa95-${past.id}`.slice(0, 40) }] },
    });
    // m2 is on batch2, not on this roster: the whole request is refused, so complete with a valid empty-ish roster instead.
    expect(done.status).toBe(400);
    const ok = await call(attendanceRoute, "PUT", `/sessions/${past.id}/attendance`, A.token.coach, {
      params: { sessionId: past.id },
      body: { complete: true, entries: [{ memberId: A.ids.kid, status: "excused", reason: "exam", clientId: preMarkClientId(decl.id, past.id) }] },
    });
    expect(ok.status).toBe(200);
    const att = await prisma.attendance.findFirstOrThrow({ where: { sessionId: past.id, memberId: A.ids.kid } });
    expect(att.status).toBe("EXCUSED");
    expect(att.reason).toBe("EXAM");
    expect(extendsTimeline(att.status, false)).toBe(false);
  });

  it("completing without any entry for the declared member still writes the EXCUSED row (server fallback)", async (ctx) => {
    if (!prisma) return ctx.skip();
    const extra = await prisma.member.create({ data: { tenantId: A.id, displayName: "QA Extra A", joinedOn: new Date(`${d(-60)}T00:00:00Z`) } });
    await prisma.batchMember.create({ data: { tenantId: A.id, batchId: A.ids.batch1, memberId: extra.id, joinedOn: new Date(`${d(-60)}T00:00:00Z`) } });
    const start = new Date(Date.now() - 2 * 3_600_000 - 5000);
    const past = await prisma.session.create({ data: { tenantId: A.id, batchId: A.ids.batch1, coachId: A.user.coach, startsAt: start, endsAt: new Date(start.getTime() + 3_600_000) } });
    const day = new Date(start.getTime() + 330 * 60_000).toISOString().slice(0, 10);
    await prisma.excusedAbsence.create({
      data: { tenantId: A.id, memberId: A.ids.kid, sessionId: past.id, fromDate: new Date(`${day}T00:00:00Z`), toDate: new Date(`${day}T00:00:00Z`), reason: "TRAVEL", createdById: A.user.parent },
    });
    const res = await call(attendanceRoute, "PUT", `/sessions/${past.id}/attendance`, A.token.coach, {
      params: { sessionId: past.id },
      body: { complete: true, entries: [{ memberId: extra.id, status: "present", clientId: `qa95-extra-${past.id}`.slice(0, 40) }] },
    });
    expect(res.status).toBe(200);
    const rows = await prisma.attendance.findMany({ where: { sessionId: past.id } });
    expect(rows.find((r) => r.memberId === A.ids.kid)).toMatchObject({ status: "EXCUSED", reason: "TRAVEL" });
    expect(rows.find((r) => r.memberId === extra.id)?.status).toBe("PRESENT");
    expect(rows.filter((r) => extendsTimeline(r.status, false))).toHaveLength(0);
    // Completing again does not duplicate anything.
    await call(attendanceRoute, "PUT", `/sessions/${past.id}/attendance`, A.token.coach, {
      params: { sessionId: past.id },
      body: { complete: true, entries: [{ memberId: extra.id, status: "present", clientId: `qa95-extra-${past.id}`.slice(0, 40) }] },
    });
    expect(await prisma.attendance.count({ where: { sessionId: past.id } })).toBe(2);
  });

  it("the coach stays in charge: a mark made on the roll call wins over the declaration", async (ctx) => {
    if (!prisma) return ctx.skip();
    const sid = await A.fresh.futureSession();
    await declare(A, "parent", A.ids.kid, { sessionId: sid, reason: "illness" });
    const put = await call(attendanceRoute, "PUT", `/sessions/${sid}/attendance`, A.token.coach, {
      params: { sessionId: sid },
      body: { entries: [{ memberId: A.ids.kid, status: "present", clientId: `qa95-ovr-${sid}`.slice(0, 40) }] },
    });
    expect(put.status).toBe(200);
    expect(rosterRow(put.body, A.ids.kid)).toMatchObject({ attendance: "present", preMarked: false, declaredReason: "illness" });
  });

  it("validation: past dates, reversed or too long ranges, bad reasons, mixing a session with dates, unknown fields", async (ctx) => {
    if (!prisma) return ctx.skip();
    const bad = async (body: unknown, field: string) => {
      const r = await declare(A, "parent", A.ids.kid, body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(validateSchemaName(r.body, "Error")).toEqual([]);
      expect(JSON.stringify(r.body.error.details)).toContain(field);
    };
    await bad({ fromDate: d(-1), reason: "exam" }, "fromDate");
    await bad({ fromDate: d(5), toDate: d(4), reason: "exam" }, "toDate");
    await bad({ fromDate: d(5), toDate: d(5 + MAX_RANGE_DAYS), reason: "exam" }, "toDate");
    await bad({ fromDate: d(5), reason: "holiday" }, "reason");
    await bad({ fromDate: d(5) }, "reason");
    await bad({ reason: "exam" }, "fromDate");
    await bad({ fromDate: "2026-02-30", reason: "exam" }, "fromDate");
    await bad({ fromDate: d(5), reason: "exam", note: "x".repeat(281) }, "note");
    await bad({ sessionId: A.ids.sessionFuture, fromDate: d(5), reason: "exam" }, "sessionId");
  });

  it("declaring the same thing twice is a conflict; sessions that started or are cancelled cannot be declared", async (ctx) => {
    if (!prisma) return ctx.skip();
    const sid = await A.fresh.futureSession();
    expect((await declare(A, "parent", A.ids.kid, { sessionId: sid, reason: "exam" })).status).toBe(201);
    expect((await declare(A, "parent", A.ids.kid, { sessionId: sid, reason: "exam" })).status).toBe(409);
    expect((await declare(A, "parent", A.ids.kid, { fromDate: d(40), toDate: d(42), reason: "travel" })).status).toBe(201);
    expect((await declare(A, "parent", A.ids.kid, { fromDate: d(41), toDate: d(41), reason: "travel" })).status).toBe(409);
    expect((await declare(A, "parent", A.ids.kid, { sessionId: A.ids.sessionPast, reason: "exam" })).status).toBe(409);
    const cancelled = await prisma.session.create({
      data: { tenantId: A.id, batchId: A.ids.batch1, coachId: A.user.coach, startsAt: new Date(Date.now() + 20 * dayMs), endsAt: new Date(Date.now() + 20 * dayMs + 3_600_000), status: "CANCELLED" },
    });
    expect((await declare(A, "parent", A.ids.kid, { sessionId: cancelled.id, reason: "exam" })).status).toBe(409);
  });

  it("tenant isolation and own view: other families, staff and the other tenant cannot declare, read or withdraw", async (ctx) => {
    if (!prisma) return ctx.skip();
    const mine = await declare(A, "parent", A.ids.kid, { fromDate: d(60), reason: "exam" });
    expect(mine.status).toBe(201);
    // Another family in the same tenant.
    expect((await declare(A, "stranger", A.ids.kid, { fromDate: d(61), reason: "exam" })).status).toBe(403);
    expect((await list(A, "stranger", A.ids.kid)).status).toBe(403);
    expect((await withdraw(A, "stranger", mine.body.id)).status).toBe(403);
    // Staff cannot declare or withdraw on a family's behalf.
    expect((await declare(A, "coach", A.ids.kid, { fromDate: d(62), reason: "exam" })).status).toBe(403);
    expect((await declare(A, "owner", A.ids.kid, { fromDate: d(62), reason: "exam" })).status).toBe(403);
    expect((await withdraw(A, "coach", mine.body.id)).status).toBe(403);
    // The coach of the member's batch and the owner can read; the other coach cannot.
    expect((await list(A, "coach", A.ids.kid)).status).toBe(200);
    expect((await list(A, "owner", A.ids.kid)).status).toBe(200);
    expect((await call(listRoute, "GET", "", A.token.coachX, { params: { memberId: A.ids.kid } })).status).toBe(403);
    // Tenant B: A's ids are not found, in every direction, and nothing leaks.
    expect((await declare(B, "parent", A.ids.kid, { fromDate: d(63), reason: "exam" })).status).toBe(404);
    expect((await list(B, "parent", A.ids.kid)).status).toBe(404);
    expect((await withdraw(B, "parent", mine.body.id)).status).toBe(404);
    expect((await declare(A, "parent", B.ids.kid, { fromDate: d(63), reason: "exam" })).status).toBe(404);
    expect((await declare(A, "parent", A.ids.kid, { sessionId: B.ids.sessionFuture, reason: "exam" })).status).toBe(404);
    const bList = await list(B, "parent", B.ids.kid);
    expect(JSON.stringify(bList.body)).not.toContain(A.ids.kid);
    expect(await prisma.excusedAbsence.count({ where: { tenantId: B.id } })).toBe(0);
    // Tenant B's roll call never shows A's declarations.
    const bSession = await detail(B, "coach", B.ids.sessionFuture);
    expect(bSession.body.roster.every((r: any) => r.preMarked === false)).toBe(true);
  });

  it("requires sign-in", async (ctx) => {
    if (!prisma) return ctx.skip();
    const r = await call(createRoute, "POST", "", undefined, { body: { fromDate: d(5), reason: "exam" }, params: { memberId: A.ids.kid } });
    expect(r.status).toBe(401);
  });
});
