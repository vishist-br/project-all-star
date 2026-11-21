import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { hashToken } from "../lib/auth/tokens";
import { extendsTimeline } from "../lib/api/attendance";
import { tryConnect } from "./helpers-db";
import { validateSchemaName } from "./contract-schema";
import { POST as createSession } from "../app/api/v1/sessions/route";
import { GET as getSession, PATCH as patchSession } from "../app/api/v1/sessions/[sessionId]/route";
import { PUT as putAttendance } from "../app/api/v1/sessions/[sessionId]/attendance/route";
import { GET as getMember } from "../app/api/v1/members/[memberId]/route";

/* eslint-disable @typescript-eslint/no-explicit-any */

describe("extendsTimeline rule (no database)", () => {
  it("only a plain absence on a non-holiday session extends the timeline", () => {
    expect(extendsTimeline("ABSENT", false)).toBe(true);
    expect(extendsTimeline("ABSENT", true)).toBe(false);
    expect(extendsTimeline("EXCUSED", false)).toBe(false);
    expect(extendsTimeline("PRESENT", false)).toBe(false);
  });
});

describe("session write + roll call API (local Postgres, own data)", () => {
  let prisma: PrismaClient | null = null;
  const sfx = Math.random().toString(36).slice(2, 8);
  const tokens: Record<string, string> = {};
  const authIds: string[] = [];
  const ids: Record<string, string> = {};
  const tenantIds: string[] = [];

  const mkUser = async (tenantId: string, role: "OWNER" | "COACH" | "CUSTOMER", key: string) => {
    const u = await prisma!.user.create({
      data: { tenantId, role, email: `${key}-${sfx}@sw.example.test`, name: `Test ${key}` },
    });
    ids[key] = u.id;
    const token = `sw-${key}-${sfx}-${Math.random().toString(36).slice(2)}`;
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

  const mkMember = async (tenantId: string, key: string, extra: Record<string, unknown> = {}) => {
    const m = await prisma!.member.create({
      data: { tenantId, displayName: `Test Member ${key}`, joinedOn: new Date("2026-01-01"), ...extra },
    });
    ids[key] = m.id;
    return m;
  };

  beforeAll(async () => {
    prisma = await tryConnect();
    if (!prisma) return;
    const A = await prisma.tenant.create({ data: { slug: `sw-a-${sfx}`, name: "SW A" } });
    const B = await prisma.tenant.create({ data: { slug: `sw-b-${sfx}`, name: "SW B" } });
    tenantIds.push(A.id, B.id);
    await mkUser(A.id, "OWNER", "ownerA");
    await mkUser(A.id, "COACH", "coachA");
    await mkUser(A.id, "COACH", "coachA2");
    const parent = await mkUser(A.id, "CUSTOMER", "parentA");
    await mkUser(A.id, "CUSTOMER", "strangerA");
    await mkUser(B.id, "OWNER", "ownerB");
    await mkUser(B.id, "COACH", "coachB");

    const venue = await prisma.venue.create({ data: { tenantId: A.id, name: "Hall" } });
    const sport = await prisma.sport.create({ data: { tenantId: A.id, slug: "karate", name: "Karate" } });
    const venueB = await prisma.venue.create({ data: { tenantId: B.id, name: "Hall B" } });
    const sportB = await prisma.sport.create({ data: { tenantId: B.id, slug: "karate", name: "Karate" } });
    const mkBatch = async (tenantId: string, key: string, coachId: string, venueId: string, sportId: string, capacity: number | null) => {
      const b = await prisma!.batch.create({
        data: { tenantId, venueId, sportId, coachId, name: `Batch ${key}`, capacity, daysOfWeek: [1], startTime: "07:00", endTime: "08:00" },
      });
      ids[key] = b.id;
    };
    await mkBatch(A.id, "batchA", ids.coachA, venue.id, sport.id, 2);
    await mkBatch(A.id, "batchA2", ids.coachA2, venue.id, sport.id, null);
    await mkBatch(B.id, "batchB", ids.coachB, venueB.id, sportB.id, null);

    const guardian = await prisma.guardian.create({ data: { tenantId: A.id, userId: parent.id, name: "Test Guardian" } });
    await mkMember(A.id, "kid", { guardianId: guardian.id, isMinor: true });
    await mkMember(A.id, "adult1");
    await mkMember(A.id, "booked");
    await mkMember(A.id, "waitlisted");
    await mkMember(A.id, "outsider"); // enrolled with coachA2 only
    await mkMember(A.id, "stranger", { userId: ids.strangerA });
    await mkMember(B.id, "memberB");
    for (const m of ["kid", "adult1"]) {
      await prisma.batchMember.create({ data: { tenantId: A.id, batchId: ids.batchA, memberId: ids[m], joinedOn: new Date("2026-01-01") } });
    }
    await prisma.batchMember.create({ data: { tenantId: A.id, batchId: ids.batchA2, memberId: ids.outsider, joinedOn: new Date("2026-01-01") } });
    await prisma.batchMember.create({ data: { tenantId: B.id, batchId: ids.batchB, memberId: ids.memberB, joinedOn: new Date("2026-01-01") } });

    await prisma.coachAvailability.create({
      data: { tenantId: A.id, coachId: ids.coachA, weekday: 1, startTime: "06:00", endTime: "12:00" },
    });
    await prisma.holiday.create({ data: { tenantId: A.id, date: new Date("2026-10-14"), name: "Test Holiday" } });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.authSession.deleteMany({ where: { id: { in: authIds } } });
    // Restrict relations (session -> batch -> venue) need an explicit order before the tenant cascade.
    for (const tenantId of tenantIds) {
      await prisma.memberUpdate.deleteMany({ where: { tenantId } });
      await prisma.sessionBooking.deleteMany({ where: { tenantId } });
      await prisma.attendance.deleteMany({ where: { tenantId } });
      await prisma.session.deleteMany({ where: { tenantId } });
      await prisma.batch.deleteMany({ where: { tenantId } });
      await prisma.tenant.delete({ where: { id: tenantId } });
    }
    await prisma.$disconnect();
  });

  const call = async (handler: any, method: string, path: string, who?: string, body?: unknown, sessionId?: string, memberId?: string) => {
    const res = await handler(
      new Request(`http://localhost/api/v1${path}`, {
        method,
        headers: { ...(who ? { authorization: `Bearer ${tokens[who]}` } : {}), "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      sessionId || memberId ? { params: Promise.resolve({ sessionId, memberId }) } : undefined,
    );
    return { status: res.status as number, body: (await res.json()) as any };
  };
  const create = (who: string, body: unknown) => call(createSession, "POST", "/sessions", who, body);
  const get = (who: string, id: string) => call(getSession, "GET", `/sessions/${id}`, who, undefined, id);
  const patch = (who: string, id: string, body: unknown) => call(patchSession, "PATCH", `/sessions/${id}`, who, body, id);
  const roll = (who: string, id: string, body: unknown) => call(putAttendance, "PUT", `/sessions/${id}/attendance`, who, body, id);
  const ist = (date: string, time: string) => `${date}T${time}:00+05:30`;
  const mkSession = async (who: string, batchKey: string, date: string, time: string, endTime: string, extra: object = {}) => {
    const r = await create(who, { batchId: ids[batchKey], startsAt: ist(date, time), endsAt: ist(date, endTime), ...extra });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.id as string;
  };
  const entry = (memberKey: string, status: string, clientId: string, extra: object = {}) => ({
    memberId: ids[memberKey],
    status,
    clientId,
    ...extra,
  });

  it("requires auth and the right role", async (ctx) => {
    if (!prisma) return ctx.skip();
    const body = { batchId: ids.batchA, startsAt: ist("2026-09-01", "07:00"), endsAt: ist("2026-09-01", "08:00") };
    expect((await create("", body)).status).toBe(401);
    expect((await create("parentA", body)).status).toBe(403);
    const sid = await mkSession("ownerA", "batchA", "2026-09-01", "07:00", "08:00");
    expect((await call(getSession, "GET", `/sessions/${sid}`, undefined, undefined, sid)).status).toBe(401);
    expect((await patch("parentA", sid, { coachNote: "x" })).status).toBe(403);
    expect((await roll("parentA", sid, { entries: [entry("kid", "present", "client-kid-0001")] })).status).toBe(403);
    expect((await roll("", sid, { entries: [] })).status).toBe(401);
  });

  it("createSession (batch): coach own batch, contract shape, validation", async (ctx) => {
    if (!prisma) return ctx.skip();
    const r = await create("coachA", { batchId: ids.batchA, startsAt: ist("2026-10-12", "07:00"), endsAt: ist("2026-10-12", "08:00"), title: "Extra sparring" });
    expect(r.status).toBe(201);
    expect(validateSchemaName(r.body, "SessionDetail")).toEqual([]);
    expect(r.body).toMatchObject({ coachId: ids.coachA, status: "scheduled", kind: "group_class", title: "Extra sparring", capacity: 2, isHoliday: false });
    expect(r.body.warnings).toEqual([]); // Monday 07:00-08:00 is inside the declared availability
    expect(r.body.roster.map((e: any) => e.memberId).sort()).toEqual([ids.kid, ids.adult1].sort());

    const bad: [string, unknown][] = [
      ["neither batch nor member", { startsAt: ist("2026-10-19", "07:00"), endsAt: ist("2026-10-19", "08:00") }],
      ["both batch and member", { batchId: ids.batchA, memberId: ids.kid, startsAt: ist("2026-10-19", "07:00"), endsAt: ist("2026-10-19", "08:00") }],
      ["end before start", { batchId: ids.batchA, startsAt: ist("2026-10-19", "08:00"), endsAt: ist("2026-10-19", "07:00") }],
      ["not a date", { batchId: ids.batchA, startsAt: "tomorrow", endsAt: ist("2026-10-19", "07:00") }],
      ["too long", { batchId: ids.batchA, startsAt: ist("2026-10-19", "01:00"), endsAt: ist("2026-10-19", "20:00") }],
      ["capacity 0", { batchId: ids.batchA, startsAt: ist("2026-10-19", "07:00"), endsAt: ist("2026-10-19", "08:00"), capacity: 0 }],
      ["title too long", { batchId: ids.batchA, startsAt: ist("2026-10-19", "07:00"), endsAt: ist("2026-10-19", "08:00"), title: "x".repeat(81) }],
    ];
    for (const [label, body] of bad) {
      const e = await create("coachA", body);
      expect(e.status, label).toBe(400);
      expect(e.body.error.code).toBe("validation_failed");
      expect(validateSchemaName(e.body, "Error")).toEqual([]);
    }
    const notJson = await createSession(new Request("http://localhost/api/v1/sessions", { method: "POST", headers: { authorization: `Bearer ${tokens.coachA}` }, body: "{nope" }));
    expect(notJson.status).toBe(400);
  });

  it("createSession: ownership, tenant isolation, overlap conflict, owner picks a coach", async (ctx) => {
    if (!prisma) return ctx.skip();
    const at = { startsAt: ist("2026-10-26", "07:00"), endsAt: ist("2026-10-26", "08:00") };
    expect((await create("coachA", { batchId: ids.batchA2, ...at })).status).toBe(403); // another coach's batch
    expect((await create("coachA", { batchId: ids.batchB, ...at })).status).toBe(404); // other tenant
    expect((await create("ownerB", { batchId: ids.batchA, ...at })).status).toBe(404);
    expect((await create("coachA", { batchId: "nope", ...at })).status).toBe(404);
    // coachId is forced to self for a coach, even when another one is passed.
    const own = await create("coachA", { batchId: ids.batchA, coachId: ids.coachA2, ...at });
    expect(own.status).toBe(201);
    expect(own.body.coachId).toBe(ids.coachA);
    // Overlap with the same coach's scheduled session.
    const clash = await create("coachA", { batchId: ids.batchA, startsAt: ist("2026-10-26", "07:30"), endsAt: ist("2026-10-26", "08:30") });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe("conflict");
    expect((await create("coachA", { batchId: ids.batchA, ...at })).status).toBe(409); // same batch + start
    // Back to back is fine; a cancelled session no longer blocks.
    expect((await create("coachA", { batchId: ids.batchA, startsAt: ist("2026-10-26", "08:00"), endsAt: ist("2026-10-26", "09:00") })).status).toBe(201);
    // Owner may pick any coach of the tenant, not a coach of another tenant.
    const picked = await create("ownerA", { batchId: ids.batchA, coachId: ids.coachA2, startsAt: ist("2026-10-27", "07:00"), endsAt: ist("2026-10-27", "08:00") });
    expect(picked.status).toBe(201);
    expect(picked.body.coachId).toBe(ids.coachA2);
    expect((await create("ownerA", { batchId: ids.batchA, coachId: ids.coachB, startsAt: ist("2026-10-28", "07:00"), endsAt: ist("2026-10-28", "08:00") })).status).toBe(404);
  });

  it("createSession is idempotent by clientId", async (ctx) => {
    if (!prisma) return ctx.skip();
    const body = { batchId: ids.batchA, clientId: `cid-${sfx}-0001`, startsAt: ist("2026-11-02", "07:00"), endsAt: ist("2026-11-02", "08:00") };
    const a = await create("coachA", body);
    const b = await create("coachA", body);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body.id).toBe(a.body.id);
    expect(await prisma.session.count({ where: { clientId: body.clientId } })).toBe(1);
    expect((await create("coachA2", { ...body, batchId: ids.batchA2 })).status).toBe(409); // someone else's clientId
  });

  it("createSession (one-on-one): creates then reuses the ONE_ON_ONE batch and writes an update", async (ctx) => {
    if (!prisma) return ctx.skip();
    const first = await create("coachA", { memberId: ids.kid, startsAt: ist("2026-11-09", "09:00"), endsAt: ist("2026-11-09", "10:00") });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(validateSchemaName(first.body, "SessionDetail")).toEqual([]);
    expect(first.body).toMatchObject({ kind: "one_on_one", coachId: ids.coachA, capacity: 1 });
    expect(first.body.roster.map((e: any) => e.memberId)).toEqual([ids.kid]);
    const second = await create("coachA", { memberId: ids.kid, startsAt: ist("2026-11-16", "09:00"), endsAt: ist("2026-11-16", "10:00") });
    expect(second.status).toBe(201);
    expect(second.body.batchId).toBe(first.body.batchId);
    expect(await prisma.batch.count({ where: { coachId: ids.coachA, kind: "ONE_ON_ONE" } })).toBe(1);
    const updates = await prisma.memberUpdate.findMany({ where: { memberId: ids.kid, kind: "SESSION_SCHEDULED" } });
    expect(updates).toHaveLength(2);
    expect(JSON.stringify(updates[0].params)).not.toContain("Test Member"); // no names in params
    // A coach cannot reach a member outside their batches; other tenants' members are 404.
    expect((await create("coachA", { memberId: ids.outsider, startsAt: ist("2026-11-09", "11:00"), endsAt: ist("2026-11-09", "12:00") })).status).toBe(403);
    expect((await create("coachA", { memberId: ids.memberB, startsAt: ist("2026-11-09", "11:00"), endsAt: ist("2026-11-09", "12:00") })).status).toBe(404);
    // capacity makes no sense for a one-on-one.
    expect((await create("coachA", { memberId: ids.kid, capacity: 3, startsAt: ist("2026-11-09", "13:00"), endsAt: ist("2026-11-09", "14:00") })).status).toBe(400);
    // Owner infers the coach from the member's enrolment.
    const viaOwner = await create("ownerA", { memberId: ids.adult1, startsAt: ist("2026-11-09", "15:00"), endsAt: ist("2026-11-09", "16:00") });
    expect(viaOwner.status).toBe(201);
    expect(viaOwner.body.coachId).toBe(ids.coachA);
  });

  it("createSession warns (does not block) outside availability and on a holiday", async (ctx) => {
    if (!prisma) return ctx.skip();
    const r = await create("coachA", { batchId: ids.batchA, startsAt: ist("2026-10-14", "07:00"), endsAt: ist("2026-10-14", "08:00") });
    expect(r.status).toBe(201);
    expect(r.body.isHoliday).toBe(true);
    expect(r.body.warnings.map((w: any) => w.code).sort()).toEqual(["on_holiday", "outside_availability"]);
    expect(validateSchemaName(r.body, "SessionDetail")).toEqual([]);
  });

  it("getSession: roster for owner and coach, own rows only for customers, 403 and 404 rules", async (ctx) => {
    if (!prisma) return ctx.skip();
    const sid = await mkSession("coachA", "batchA", "2026-09-07", "07:00", "08:00");
    await prisma.sessionBooking.create({ data: { tenantId: (await prisma.session.findUniqueOrThrow({ where: { id: sid } })).tenantId, sessionId: sid, memberId: ids.booked, status: "BOOKED", bookedById: ids.coachA } });
    await prisma.sessionBooking.create({ data: { tenantId: (await prisma.session.findUniqueOrThrow({ where: { id: sid } })).tenantId, sessionId: sid, memberId: ids.waitlisted, status: "WAITLISTED", waitlistPosition: 1, bookedById: ids.coachA } });
    await prisma.sessionBooking.create({ data: { tenantId: (await prisma.session.findUniqueOrThrow({ where: { id: sid } })).tenantId, sessionId: sid, memberId: ids.kid, status: "BOOKED", bookedById: ids.parentA } });

    for (const who of ["ownerA", "coachA"]) {
      const r = await get(who, sid);
      expect(r.status).toBe(200);
      expect(validateSchemaName(r.body, "SessionDetail")).toEqual([]);
      const bySource = Object.fromEntries(r.body.roster.map((e: any) => [e.memberId, e.source]));
      expect(bySource).toEqual({ [ids.kid]: "enrolled", [ids.adult1]: "enrolled", [ids.booked]: "booked", [ids.waitlisted]: "waitlisted" });
      expect(r.body).toMatchObject({ bookedCount: 2, waitlistCount: 1 });
      expect(r.body.myBookings).toBeUndefined();
    }
    const c = await get("parentA", sid);
    expect(c.status).toBe(200);
    expect(validateSchemaName(c.body, "SessionDetail")).toEqual([]);
    expect(c.body.roster).toBeUndefined();
    expect(c.body.myBookings).toHaveLength(1);
    expect(c.body.myBookings[0]).toMatchObject({ memberId: ids.kid, status: "booked" });
    expect(c.body.myBookingStatus).toBe("booked");
    expect(c.body.myAttendance).toEqual([{ memberId: ids.kid, attendance: "not_marked" }]);
    expect(JSON.stringify(c.body)).not.toContain("Test Member adult1");
    expect(JSON.stringify(c.body)).not.toContain(ids.adult1);

    expect((await get("coachA2", sid)).status).toBe(403); // other coach, same tenant
    expect((await get("strangerA", sid)).status).toBe(403); // customer outside the batch
    expect((await get("ownerB", sid)).status).toBe(404); // other tenant
    expect((await get("coachB", sid)).status).toBe(404);
    expect((await get("ownerA", "missing-id")).status).toBe(404);
  });

  it("recordAttendance: marks, replays identically, validates reasons and roster", async (ctx) => {
    if (!prisma) return ctx.skip();
    const sid = await mkSession("coachA", "batchA", "2026-09-14", "07:00", "08:00");
    const memberBefore = await call(getMember, "GET", `/members/${ids.kid}`, "ownerA", undefined, undefined, ids.kid);
    const body = {
      entries: [
        entry("kid", "present", "client-kid-1001", { markedAt: "2026-09-14T01:40:00Z" }),
        entry("adult1", "excused", "client-adult-1002", { reason: "illness", note: "fever", markedAt: "2026-09-14T01:41:00Z" }),
      ],
    };
    const a = await roll("coachA", sid, body);
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    expect(validateSchemaName(a.body, "SessionDetail")).toEqual([]);
    expect(a.body.attendanceSummary).toEqual({ present: 1, absent: 0, excused: 1, total: 2 });
    const kidRow = a.body.roster.find((e: any) => e.memberId === ids.kid);
    expect(kidRow).toMatchObject({ attendance: "present", attendanceClientId: "client-kid-1001" });
    expect(a.body.roster.find((e: any) => e.memberId === ids.adult1)).toMatchObject({ attendance: "excused", excusedReason: "illness", note: "fever" });

    const rowsA = await prisma.attendance.findMany({ where: { sessionId: sid }, orderBy: { memberId: "asc" } });
    const b = await roll("coachA", sid, body); // offline replay of the same body
    expect(b.status).toBe(200);
    expect(b.body).toEqual(a.body);
    const rowsB = await prisma.attendance.findMany({ where: { sessionId: sid }, orderBy: { memberId: "asc" } });
    expect(rowsB).toEqual(rowsA); // identical rows, nothing re-written
    expect(rowsB).toHaveLength(2);

    // The member's progress reflects the roll call.
    const memberAfter = await call(getMember, "GET", `/members/${ids.kid}`, "ownerA", undefined, undefined, ids.kid);
    expect(memberAfter.body.attendance.attended).toBe(memberBefore.body.attendance.attended + 1);

    // Validation.
    const v = (entries: unknown) => roll("coachA", sid, { entries });
    expect((await v([])).status).toBe(400);
    expect((await v([entry("kid", "excused", "client-bad-0001")])).status).toBe(400); // reason missing
    expect((await v([entry("kid", "present", "client-bad-0002", { reason: "exam" })])).status).toBe(400); // reason forbidden
    expect((await v([entry("kid", "excused", "client-bad-0003", { reason: "holiday" })])).status).toBe(400);
    expect((await v([entry("kid", "late", "client-bad-0004")])).status).toBe(400);
    expect((await v([entry("kid", "present", "short")])).status).toBe(400);
    expect((await v([entry("kid", "present", "client-bad-0005", { note: "n".repeat(281) })])).status).toBe(400);
    expect((await v([entry("kid", "present", "client-bad-0006", { markedAt: "yesterday" })])).status).toBe(400);
    expect((await v([entry("kid", "present", "client-dup-0001"), entry("kid", "absent", "client-dup-0002")])).status).toBe(400);
    const tooMany = Array.from({ length: 201 }, (_, i) => ({ memberId: ids.kid, status: "present", clientId: `client-many-${i}-xxxx` }));
    expect((await v(tooMany)).status).toBe(400);
    expect((await roll("coachA", sid, { entries: [entry("kid", "present", "client-ok-00001")], complete: "yes" })).status).toBe(400);

    // Not on the roster: other batch, waitlisted-only, other tenant, unknown id.
    for (const key of ["outsider", "memberB"]) {
      const e = await v([entry(key, "present", `client-roster-${key}`)]);
      expect(e.status, key).toBe(400);
      expect(e.body.error.details[0].field).toBe("entries[0].memberId");
    }
    expect((await v([{ memberId: "ghost", status: "present", clientId: "client-ghost-01" }])).status).toBe(400);
  });

  it("recordAttendance: last write wins on markedAt, stale writes are ignored", async (ctx) => {
    if (!prisma) return ctx.skip();
    const sid = await mkSession("coachA", "batchA", "2026-09-21", "07:00", "08:00");
    const put = (status: string, clientId: string, markedAt?: string) =>
      roll("coachA", sid, { entries: [entry("kid", status, clientId, markedAt ? { markedAt } : {})] });
    const state = async () => (await prisma!.attendance.findFirstOrThrow({ where: { sessionId: sid, memberId: ids.kid } }));
    expect((await put("absent", "client-lww-0001", "2026-09-21T01:30:00Z")).status).toBe(200);
    expect((await put("present", "client-lww-0002", "2026-09-21T01:45:00Z")).status).toBe(200); // newer wins
    expect((await state()).status).toBe("PRESENT");
    expect((await put("absent", "client-lww-0001", "2026-09-21T01:30:00Z")).status).toBe(200); // late replay of the older tap
    const row = await state();
    expect(row.status).toBe("PRESENT");
    expect(row.clientId).toBe("client-lww-0002");
    expect(row.markedById).toBe(ids.coachA);
    expect(await prisma.attendance.count({ where: { sessionId: sid } })).toBe(1);
    // A clientId cannot be reused for a different member's row.
    const other = await roll("coachA", sid, { entries: [entry("adult1", "present", "client-lww-0002")] });
    expect(other.status).toBe(409);
    expect(other.body.error.code).toBe("conflict");
    // Absent can change to excused (coach corrects later).
    const fix = await roll("coachA", sid, { entries: [entry("kid", "excused", "client-lww-0003", { reason: "travel", markedAt: "2026-09-21T02:00:00Z" })] });
    expect(fix.status).toBe(200);
    expect((await state()).status).toBe("EXCUSED");
  });

  it("recordAttendance: complete sets completedAt, coach note; cancelled and future sessions are 409", async (ctx) => {
    if (!prisma) return ctx.skip();
    const sid = await mkSession("coachA", "batchA", "2026-09-28", "07:00", "08:00");
    const done = await roll("coachA", sid, {
      entries: [entry("kid", "present", "client-comp-0001")],
      complete: true,
      coachNote: "Good session",
      sessionClientId: `scid-${sfx}-0001`,
    });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ status: "completed", coachNote: "Good session" });
    const row = await prisma.session.findUniqueOrThrow({ where: { id: sid } });
    expect(row.completedAt).not.toBeNull();
    const again = await roll("coachA", sid, { entries: [entry("kid", "present", "client-comp-0001")], complete: true });
    expect(again.status).toBe(200);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: sid } })).completedAt).toEqual(row.completedAt);
    // A completed session still accepts corrections (late offline sync).
    expect((await roll("coachA", sid, { entries: [entry("adult1", "absent", "client-comp-0002")] })).status).toBe(200);

    const future = new Date(Date.now() + 7 * 86_400_000);
    const fid = (await create("coachA", { batchId: ids.batchA, startsAt: future.toISOString(), endsAt: new Date(future.getTime() + 3_600_000).toISOString() })).body.id;
    expect((await roll("coachA", fid, { entries: [entry("kid", "present", "client-fut-00001")], complete: true })).status).toBe(409);
    expect((await roll("coachA", fid, { entries: [entry("kid", "excused", "client-fut-00002", { reason: "exam" })] })).status).toBe(200); // pre-marking is fine

    const cid = await mkSession("coachA", "batchA", "2026-09-29", "07:00", "08:00");
    expect((await patch("coachA", cid, { status: "cancelled" })).status).toBe(200);
    expect((await roll("coachA", cid, { entries: [entry("kid", "present", "client-canc-0001")] })).status).toBe(409);
  });

  it("recordAttendance: ownership and tenant isolation", async (ctx) => {
    if (!prisma) return ctx.skip();
    const sid = await mkSession("coachA", "batchA", "2026-10-05", "07:00", "08:00");
    const body = { entries: [entry("kid", "present", "client-iso-00001")] };
    expect((await roll("coachA2", sid, body)).status).toBe(403);
    expect((await roll("coachB", sid, body)).status).toBe(404);
    expect((await roll("ownerB", sid, body)).status).toBe(404);
    expect(await prisma.attendance.count({ where: { sessionId: sid } })).toBe(0);
    expect((await roll("ownerA", sid, body)).status).toBe(200); // owner marks any session
  });

  it("holiday sessions: roll call works, flagged with on_holiday, rule does not extend the timeline", async (ctx) => {
    if (!prisma) return ctx.skip();
    const sid = await mkSession("coachA", "batchA", "2026-10-14", "09:00", "10:00");
    const r = await roll("coachA", sid, { entries: [entry("kid", "absent", "client-hol-00001")], complete: true });
    expect(r.status).toBe(200);
    expect(r.body.isHoliday).toBe(true);
    expect(r.body.warnings.map((w: any) => w.code)).toEqual(["on_holiday"]);
    expect(extendsTimeline("ABSENT", r.body.isHoliday)).toBe(false);
  });

  it("updateSession: reschedule writes session_rescheduled; conflicts and validation", async (ctx) => {
    if (!prisma) return ctx.skip();
    const sid = (await create("coachA", { memberId: ids.kid, startsAt: ist("2026-12-07", "09:00"), endsAt: ist("2026-12-07", "10:00") })).body.id;
    const other = await mkSession("coachA", "batchA", "2026-12-07", "11:00", "12:00");
    const r = await patch("coachA", sid, { startsAt: ist("2026-12-08", "09:30"), endsAt: ist("2026-12-08", "10:30") });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(validateSchemaName(r.body, "SessionDetail")).toEqual([]);
    expect(r.body.startsAt).toBe(new Date(ist("2026-12-08", "09:30")).toISOString());
    const upd = await prisma.memberUpdate.findMany({ where: { memberId: ids.kid, kind: "SESSION_RESCHEDULED", entityId: sid } });
    expect(upd).toHaveLength(1);
    expect(upd[0].params).toMatchObject({ date: "2026-12-08", time: "09:30" });
    // Same values again: nothing new.
    await patch("coachA", sid, { startsAt: ist("2026-12-08", "09:30") });
    expect(await prisma.memberUpdate.count({ where: { entityId: sid, kind: "SESSION_RESCHEDULED" } })).toBe(1);

    expect((await patch("coachA", other, { startsAt: ist("2026-12-08", "10:00"), endsAt: ist("2026-12-08", "11:00") })).status).toBe(409); // overlaps sid
    expect((await patch("coachA", other, { startsAt: ist("2026-12-08", "12:00"), endsAt: ist("2026-12-08", "11:00") })).status).toBe(400);
    expect((await patch("coachA", other, {})).status).toBe(400);
    expect((await patch("coachA", other, { status: "completed" })).status).toBe(400);
    expect((await patch("coachA", other, { cancelReason: "rain" })).status).toBe(400);
    expect((await patch("coachA", other, { coachNote: "n".repeat(1001) })).status).toBe(400);
    expect((await patch("coachA", other, { capacity: 501 })).status).toBe(400);
    expect((await patch("coachA", sid, { capacity: 5 })).status).toBe(400); // one-on-one
    const cap = await patch("coachA", other, { capacity: 1, coachNote: "Bring pads" });
    expect(cap.status).toBe(200);
    expect(cap.body).toMatchObject({ capacity: 1, coachNote: "Bring pads" });
    // Ownership and tenant isolation.
    expect((await patch("coachA2", other, { coachNote: "x" })).status).toBe(403);
    expect((await patch("coachB", other, { coachNote: "x" })).status).toBe(404);
    expect((await patch("ownerB", other, { coachNote: "x" })).status).toBe(404);
    expect((await patch("ownerA", other, { coachNote: "owner note" })).status).toBe(200);
  });

  it("updateSession: cancel cancels bookings, notifies once, is safe to replay; completed only takes a note", async (ctx) => {
    if (!prisma) return ctx.skip();
    const sid = await mkSession("coachA", "batchA", "2026-12-14", "07:00", "08:00");
    const tenantId = (await prisma.session.findUniqueOrThrow({ where: { id: sid } })).tenantId;
    await prisma.sessionBooking.create({ data: { tenantId, sessionId: sid, memberId: ids.booked, status: "BOOKED", bookedById: ids.coachA } });
    await prisma.sessionBooking.create({ data: { tenantId, sessionId: sid, memberId: ids.waitlisted, status: "WAITLISTED", waitlistPosition: 1, bookedById: ids.coachA } });
    const c = await patch("coachA", sid, { status: "cancelled", cancelReason: "Hall closed" });
    expect(c.status).toBe(200);
    expect(validateSchemaName(c.body, "SessionDetail")).toEqual([]);
    expect(c.body).toMatchObject({ status: "cancelled", cancelReason: "Hall closed", bookedCount: 0, waitlistCount: 0 });
    const bookings = await prisma.sessionBooking.findMany({ where: { sessionId: sid } });
    expect(bookings.every((b) => b.status === "CANCELLED" && b.waitlistPosition === null && b.cancelledAt)).toBe(true);
    const upd = await prisma.memberUpdate.findMany({ where: { entityId: sid, kind: "SESSION_CANCELLED" } });
    expect(upd.map((u) => u.memberId).sort()).toEqual([ids.booked, ids.waitlisted].sort());
    const again = await patch("coachA", sid, { status: "cancelled", cancelReason: "Hall closed" });
    expect(again.status).toBe(200);
    expect(await prisma.memberUpdate.count({ where: { entityId: sid, kind: "SESSION_CANCELLED" } })).toBe(2);
    expect((await patch("coachA", sid, { startsAt: ist("2026-12-15", "07:00"), endsAt: ist("2026-12-15", "08:00") })).status).toBe(409);
    // A cancelled slot no longer blocks the coach.
    expect((await create("coachA", { batchId: ids.batchA, startsAt: ist("2026-12-14", "07:00"), endsAt: ist("2026-12-14", "08:00") })).status).toBe(409); // same batch + start still unique
    expect((await create("coachA", { memberId: ids.kid, startsAt: ist("2026-12-14", "07:15"), endsAt: ist("2026-12-14", "07:45") })).status).toBe(201);

    // Completed: only the note may change.
    const done = await mkSession("coachA", "batchA", "2026-11-03", "07:00", "08:00");
    await roll("coachA", done, { entries: [entry("kid", "present", "client-done-0001")], complete: true });
    expect((await patch("coachA", done, { status: "cancelled" })).status).toBe(409);
    expect((await patch("coachA", done, { startsAt: ist("2026-11-04", "07:00"), endsAt: ist("2026-11-04", "08:00") })).status).toBe(409);
    const note = await patch("coachA", done, { coachNote: "Late note" });
    expect(note.status).toBe(200);
    expect(note.body).toMatchObject({ status: "completed", coachNote: "Late note" });
  });
});
