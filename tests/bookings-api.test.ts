import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { hashToken } from "../lib/auth/tokens";
import { tryConnect } from "./helpers-db";
import { validateSchemaName } from "./contract-schema";
import { GET as listSessions } from "../app/api/v1/sessions/route";
import { POST as postBooking } from "../app/api/v1/sessions/[sessionId]/bookings/route";
import { POST as postCancel } from "../app/api/v1/bookings/[bookingId]/cancel/route";
import { GET as getAvailability, PUT as putAvailability } from "../app/api/v1/coaches/[coachId]/availability/route";
import { GET as getTenant } from "../app/api/v1/tenant/route";
import { PUT as putSettings } from "../app/api/v1/tenant/settings/route";

/* eslint-disable @typescript-eslint/no-explicit-any */

describe("bookings, coach availability, tenant settings API (local Postgres, own data)", () => {
  let prisma: PrismaClient | null = null;
  const sfx = Math.random().toString(36).slice(2, 8);
  const tokens: Record<string, string> = {};
  const authIds: string[] = [];
  const ids: Record<string, string> = {};
  const tenantIds: string[] = [];
  let minute = 0; // keeps (batch, startsAt) unique

  const mkUser = async (tenantId: string, role: "OWNER" | "COACH" | "CUSTOMER", key: string) => {
    const u = await prisma!.user.create({ data: { tenantId, role, email: `${key}-${sfx}@bk.example.test`, name: `Test ${key}` } });
    ids[key] = u.id;
    const token = `bk-${key}-${sfx}-${Math.random().toString(36).slice(2)}`;
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
    const m = await prisma!.member.create({ data: { tenantId, displayName: `Test Member ${key}`, joinedOn: new Date("2026-01-01"), ...extra } });
    ids[key] = m.id;
    return m;
  };
  const enroll = (tenantId: string, batchKey: string, memberKey: string) =>
    prisma!.batchMember.create({ data: { tenantId, batchId: ids[batchKey], memberId: ids[memberKey], joinedOn: new Date("2026-01-01") } });

  /** A session `inMinutes` from now (negative = already started). */
  const mkSession = async (batchKey: string, inMinutes: number, extra: Record<string, unknown> = {}) => {
    const startsAt = new Date(Date.now() + inMinutes * 60_000 + minute++ * 1000);
    const s = await prisma!.session.create({
      data: {
        tenantId: (await prisma!.batch.findUniqueOrThrow({ where: { id: ids[batchKey] } })).tenantId,
        batchId: ids[batchKey],
        coachId: (await prisma!.batch.findUniqueOrThrow({ where: { id: ids[batchKey] } })).coachId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3_600_000),
        ...extra,
      },
    });
    return s;
  };

  beforeAll(async () => {
    prisma = await tryConnect();
    if (!prisma) return;
    const A = await prisma.tenant.create({ data: { slug: `bk-a-${sfx}`, name: "BK A" } });
    const B = await prisma.tenant.create({ data: { slug: `bk-b-${sfx}`, name: "BK B" } });
    tenantIds.push(A.id, B.id);
    await mkUser(A.id, "OWNER", "ownerA");
    await mkUser(A.id, "COACH", "coachA");
    await mkUser(A.id, "COACH", "coachA2");
    const parent = await mkUser(A.id, "CUSTOMER", "parentA");
    const adultUser = await mkUser(A.id, "CUSTOMER", "adultU");
    await mkUser(A.id, "CUSTOMER", "strangerU");
    await mkUser(B.id, "OWNER", "ownerB");
    await mkUser(B.id, "COACH", "coachB");

    const venue = await prisma.venue.create({ data: { tenantId: A.id, name: "Hall" } });
    const sport = await prisma.sport.create({ data: { tenantId: A.id, slug: "karate", name: "Karate" } });
    const venueB = await prisma.venue.create({ data: { tenantId: B.id, name: "Hall B" } });
    const sportB = await prisma.sport.create({ data: { tenantId: B.id, slug: "karate", name: "Karate" } });
    const mkBatch = async (tenantId: string, key: string, coachId: string, venueId: string, sportId: string, capacity: number | null, kind = "GROUP_CLASS") => {
      const b = await prisma!.batch.create({
        data: { tenantId, venueId, sportId, coachId, name: `Batch ${key}`, kind: kind as any, capacity, daysOfWeek: [1], startTime: "07:00", endTime: "08:00" },
      });
      ids[key] = b.id;
    };
    await mkBatch(A.id, "batch2", ids.coachA, venue.id, sport.id, 2);
    await mkBatch(A.id, "batchOpen", ids.coachA, venue.id, sport.id, null);
    await mkBatch(A.id, "batchOther", ids.coachA2, venue.id, sport.id, 5);
    await mkBatch(A.id, "batchSolo", ids.coachA, venue.id, sport.id, 1, "ONE_ON_ONE");
    await mkBatch(B.id, "batchB", ids.coachB, venueB.id, sportB.id, 2);
    ids.venueA = venue.id;
    ids.venueB = venueB.id;

    const guardian = await prisma.guardian.create({ data: { tenantId: A.id, userId: parent.id, name: "Test Guardian" } });
    await mkMember(A.id, "kid", { guardianId: guardian.id, isMinor: true });
    await mkMember(A.id, "adult", { userId: adultUser.id });
    for (const k of ["m3", "m4", "m5", "m6", "m7", "m8"]) await mkMember(A.id, k);
    await mkMember(A.id, "outsider"); // enrolled nowhere
    await mkMember(A.id, "otherKid"); // enrolled in batch2 but not the parent's child
    await mkMember(B.id, "memberB");
    for (const k of ["kid", "adult", "m3", "m4", "m5", "m6", "m7", "m8", "otherKid"]) {
      await enroll(A.id, "batch2", k);
      await enroll(A.id, "batchOpen", k);
    }
    await enroll(A.id, "batchOther", "m3");
    await enroll(A.id, "batchSolo", "kid");
    await prisma.batchMember.create({ data: { tenantId: B.id, batchId: ids.batchB, memberId: ids.memberB, joinedOn: new Date("2026-01-01") } });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.authSession.deleteMany({ where: { id: { in: authIds } } });
    for (const tenantId of tenantIds) {
      await prisma.memberUpdate.deleteMany({ where: { tenantId } });
      await prisma.sessionBooking.deleteMany({ where: { tenantId } });
      await prisma.session.deleteMany({ where: { tenantId } });
      await prisma.batch.deleteMany({ where: { tenantId } });
      await prisma.tenantSettings.deleteMany({ where: { tenantId } });
      await prisma.tenant.delete({ where: { id: tenantId } });
    }
    await prisma.$disconnect();
  });

  const call = async (handler: any, method: string, path: string, who?: string, body?: unknown, params?: Record<string, string>) => {
    const res = await handler(
      new Request(`http://localhost/api/v1${path}`, {
        method,
        headers: { ...(who ? { authorization: `Bearer ${tokens[who]}` } : {}), "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      params ? { params: Promise.resolve(params) } : undefined,
    );
    return { status: res.status as number, body: (await res.json()) as any };
  };
  const book = (who: string, sessionId: string, memberKey: string | null) =>
    call(postBooking, "POST", `/sessions/${sessionId}/bookings`, who, memberKey === null ? {} : { memberId: ids[memberKey] ?? memberKey }, { sessionId });
  const cancel = (who: string, bookingId: string) => call(postCancel, "POST", `/bookings/${bookingId}/cancel`, who, undefined, { bookingId });
  const setSettings = (who: string, body: unknown) => call(putSettings, "PUT", "/tenant/settings", who, body);
  const bookingRow = (id: string) => prisma!.sessionBooking.findUniqueOrThrow({ where: { id } });
  const updates = (memberKey: string, kind: string) =>
    prisma!.memberUpdate.findMany({ where: { memberId: ids[memberKey], kind: kind as any } });

  it("requires auth, and the right row-level access per role", async (ctx) => {
    if (!prisma) return ctx.skip();
    const s = await mkSession("batch2", 60 * 24 * 3);
    expect((await book("", s.id, "kid")).status).toBe(401);
    expect((await cancel("", "x")).status).toBe(401);
    expect((await call(getAvailability, "GET", `/coaches/${ids.coachA}/availability`, "", undefined, { coachId: ids.coachA })).status).toBe(401);
    expect((await call(putSettings, "PUT", "/tenant/settings", "", {})).status).toBe(401);

    // Coach of another batch cannot book into this session; the owning coach can.
    expect((await book("coachA2", s.id, "kid")).status).toBe(403);
    const byCoach = await book("coachA", s.id, "kid");
    expect(byCoach.status).toBe(201);
    // A customer with no member in the batch has no view of the session at all.
    expect((await book("strangerU", s.id, "kid")).status).toBe(403);
    // Parent cancels the child's booking; a stranger customer may not.
    expect((await cancel("strangerU", byCoach.body.id)).status).toBe(403);
    expect((await cancel("coachA2", byCoach.body.id)).status).toBe(403);
    expect((await cancel("parentA", byCoach.body.id)).status).toBe(200);
  });

  it("customer books only self or own child, and only enrolled batches", async (ctx) => {
    if (!prisma) return ctx.skip();
    const s = await mkSession("batch2", 60 * 24 * 4);
    const ok = await book("parentA", s.id, "kid");
    expect(ok.status).toBe(201);
    expect(validateSchemaName(ok.body, "Booking")).toEqual([]);
    expect(ok.body).toMatchObject({ status: "booked", waitlistPosition: null, memberId: ids.kid, cancelledAt: null });
    expect(ok.body.cancellableUntil).toBe(new Date(s.startsAt.getTime() - 120 * 60_000).toISOString());
    expect((await book("adultU", s.id, "adult")).status).toBe(201);
    // not their member
    expect((await book("parentA", s.id, "otherKid")).status).toBe(403);
    expect((await book("adultU", s.id, "kid")).status).toBe(403);
    // own child but not enrolled in the session's batch
    const solo = await mkSession("batchOther", 60 * 24 * 4);
    expect((await book("parentA", solo.id, "kid")).status).toBe(403);
    // owner may book anyone in the tenant (also non-enrolled); coach only their own sessions
    const extra = await book("ownerA", s.id, "outsider"); // staff may add a non-enrolled member (full: waitlisted)
    expect([extra.status, extra.body.status]).toEqual([201, "waitlisted"]);
  });

  it("validates input and hides other tenants (404, never 403)", async (ctx) => {
    if (!prisma) return ctx.skip();
    const s = await mkSession("batchOpen", 60 * 24 * 5);
    for (const body of [{}, { memberId: "" }, { memberId: 5 }]) {
      const r = await call(postBooking, "POST", `/sessions/${s.id}/bookings`, "ownerA", body, { sessionId: s.id });
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe("validation_failed");
      expect(validateSchemaName(r.body, "Error")).toEqual([]);
    }
    expect((await book("ownerA", s.id, "nope")).status).toBe(404);
    expect((await book("ownerA", s.id, "memberB")).status).toBe(404); // member of tenant B
    expect((await book("ownerA", "nope", "kid")).status).toBe(404);
    const sB = await mkSession("batchB", 60 * 24 * 5);
    expect((await book("ownerA", sB.id, "kid")).status).toBe(404); // session of tenant B
    expect((await book("ownerB", s.id, "memberB")).status).toBe(404);
    const mine = await book("ownerA", s.id, "kid");
    expect((await cancel("ownerB", mine.body.id)).status).toBe(404); // booking of tenant A
    expect((await cancel("ownerA", "nope")).status).toBe(404);
  });

  it("non-bookable sessions answer 409: one-on-one, cancelled, started", async (ctx) => {
    if (!prisma) return ctx.skip();
    const solo = await mkSession("batchSolo", 60 * 24 * 2);
    expect((await book("ownerA", solo.id, "kid")).status).toBe(409);
    const cancelled = await mkSession("batchOpen", 60 * 24 * 2, { status: "CANCELLED" });
    expect((await book("ownerA", cancelled.id, "kid")).status).toBe(409);
    const started = await mkSession("batchOpen", -10);
    expect((await book("ownerA", started.id, "kid")).status).toBe(409);
    const inactive = await mkSession("batchOpen", 60 * 24 * 2);
    await prisma.member.update({ where: { id: ids.outsider }, data: { isActive: false } });
    expect((await book("ownerA", inactive.id, "outsider")).status).toBe(409);
    await prisma.member.update({ where: { id: ids.outsider }, data: { isActive: true } });
  });

  it("capacity, waitlist positions, duplicate guard, promotion and renumbering", async (ctx) => {
    if (!prisma) return ctx.skip();
    const s = await mkSession("batch2", 60 * 24 * 6); // capacity 2 from the batch
    const b1 = await book("parentA", s.id, "kid");
    const b2 = await book("adultU", s.id, "adult");
    expect([b1.body.status, b2.body.status]).toEqual(["booked", "booked"]);
    expect((await book("adultU", s.id, "adult")).status).toBe(409); // duplicate
    const w1 = await book("ownerA", s.id, "m3");
    const w2 = await book("ownerA", s.id, "m4");
    const w3 = await book("ownerA", s.id, "m5");
    expect([w1.status, w1.body.status, w1.body.waitlistPosition]).toEqual([201, "waitlisted", 1]);
    expect([w2.body.status, w2.body.waitlistPosition]).toEqual(["waitlisted", 2]);
    expect(w3.body.waitlistPosition).toBe(3);
    expect(validateSchemaName(w1.body, "Booking")).toEqual([]);
    // Staff booking a confirmed place writes a booking_confirmed update; waitlisted does not.
    expect((await updates("m3", "BOOKING_CONFIRMED")).length).toBe(0);

    // Counts in listSessions, and a customer sees only their own status.
    const list = await call(listSessions, "GET", "/sessions?limit=100", "ownerA");
    const row = list.body.items.find((x: any) => x.id === s.id);
    expect(row).toMatchObject({ kind: "group_class", capacity: 2, bookedCount: 2, waitlistCount: 3 });
    expect(row.myBookingStatus).toBeUndefined();
    const mineList = await call(listSessions, "GET", "/sessions?limit=100", "parentA");
    expect(mineList.body.items.find((x: any) => x.id === s.id).myBookingStatus).toBe("booked");
    expect(validateSchemaName(mineList.body, "SessionPage")).toEqual([]);

    // A booked member cancels: waitlist position 1 is promoted, others renumber.
    const c = await cancel("parentA", b1.body.id);
    expect(c.status).toBe(200);
    expect(c.body).toMatchObject({ status: "cancelled", waitlistPosition: null, cancellableUntil: null });
    expect(c.body.cancelledAt).toBeTruthy();
    expect(validateSchemaName(c.body, "Booking")).toEqual([]);
    expect(await bookingRow(w1.body.id)).toMatchObject({ status: "BOOKED", waitlistPosition: null });
    expect(await bookingRow(w2.body.id)).toMatchObject({ status: "WAITLISTED", waitlistPosition: 1 });
    expect(await bookingRow(w3.body.id)).toMatchObject({ status: "WAITLISTED", waitlistPosition: 2 });
    const promo = await updates("m3", "WAITLIST_PROMOTED");
    expect(promo.length).toBe(1);
    expect(promo[0]).toMatchObject({ entityType: "booking", entityId: w1.body.id, actorId: ids.parentA });
    expect(Object.keys(promo[0].params as object).sort()).toEqual(["batchName", "date", "time"]);
    expect(JSON.stringify(promo[0].params)).not.toContain("Test Member");

    // Cancelling a waitlisted place only renumbers, never promotes.
    const cw = await cancel("ownerA", w2.body.id);
    expect(cw.body.status).toBe("cancelled");
    expect(await bookingRow(w3.body.id)).toMatchObject({ status: "WAITLISTED", waitlistPosition: 1 });
    expect((await updates("m4", "WAITLIST_PROMOTED")).length).toBe(0);

    // Cancelling twice is a safe replay.
    const again = await cancel("parentA", b1.body.id);
    expect(again.status).toBe(200);
    expect(again.body.status).toBe("cancelled");
    expect((await updates("m3", "WAITLIST_PROMOTED")).length).toBe(1);

    // Re-booking after cancelling reuses the row and joins the back of the queue.
    const back = await book("parentA", s.id, "kid");
    expect(back.status).toBe(201);
    expect(back.body.id).toBe(b1.body.id);
    expect(back.body).toMatchObject({ status: "waitlisted", waitlistPosition: 2 });
  });

  it("a raised capacity is filled from the waitlist on the next cancellation, and uncapped classes never wait", async (ctx) => {
    if (!prisma) return ctx.skip();
    const s = await mkSession("batch2", 60 * 24 * 7, { capacity: 1 }); // session capacity overrides the batch
    const a = await book("ownerA", s.id, "m3");
    const w1 = await book("ownerA", s.id, "m4");
    const w2 = await book("ownerA", s.id, "m5");
    expect(a.body.status).toBe("booked");
    expect(w1.body.waitlistPosition).toBe(1);
    await prisma.session.update({ where: { id: s.id }, data: { capacity: 3 } });
    await cancel("ownerA", a.body.id);
    expect((await bookingRow(w1.body.id)).status).toBe("BOOKED");
    expect((await bookingRow(w2.body.id)).status).toBe("BOOKED"); // two free places, two promotions

    const open = await mkSession("batchOpen", 60 * 24 * 7);
    for (const k of ["m3", "m4", "m5", "m6"]) expect((await book("ownerA", open.id, k)).body.status).toBe("booked");
    const row = (await call(listSessions, "GET", "/sessions?limit=100", "coachA")).body.items.find((x: any) => x.id === open.id);
    expect(row).toMatchObject({ capacity: null, bookedCount: 4, waitlistCount: 0 });
  });

  it("concurrent bookings for the last place never exceed capacity", async (ctx) => {
    if (!prisma) return ctx.skip();
    const s = await mkSession("batch2", 60 * 24 * 8, { capacity: 1 });
    const members = ["m3", "m4", "m5", "m6", "m7", "m8"];
    const results = await Promise.all(members.map((k) => book("ownerA", s.id, k)));
    expect(results.every((r) => r.status === 201)).toBe(true);
    const rows = await prisma.sessionBooking.findMany({ where: { sessionId: s.id } });
    expect(rows.filter((r) => r.status === "BOOKED").length).toBe(1);
    const positions = rows.filter((r) => r.status === "WAITLISTED").map((r) => r.waitlistPosition).sort();
    expect(positions).toEqual([1, 2, 3, 4, 5]);

    // Concurrent cancel of the only place and a new booking stays consistent too.
    const booked = rows.find((r) => r.status === "BOOKED")!;
    await Promise.all([cancel("ownerA", booked.id), book("ownerA", s.id, "adult")]);
    const after = await prisma.sessionBooking.findMany({ where: { sessionId: s.id, status: { not: "CANCELLED" } } });
    expect(after.filter((r) => r.status === "BOOKED").length).toBe(1);
    expect(after.filter((r) => r.status === "WAITLISTED").map((r) => r.waitlistPosition).sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("waitlist disabled: a full session answers 409; existing waitlisted members are still promoted", async (ctx) => {
    if (!prisma) return ctx.skip();
    const s = await mkSession("batch2", 60 * 24 * 9, { capacity: 1 });
    const a = await book("ownerA", s.id, "m3");
    const w = await book("ownerA", s.id, "m4");
    expect(w.body.status).toBe("waitlisted");
    expect((await setSettings("ownerA", { waitlistEnabled: false })).status).toBe(200);
    const full = await book("ownerA", s.id, "m5");
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe("conflict");
    await cancel("ownerA", a.body.id);
    expect((await bookingRow(w.body.id)).status).toBe("BOOKED");
    expect((await setSettings("ownerA", { waitlistEnabled: true })).status).toBe(200);
  });

  it("cancellation window: customer blocked inside it (409 + details), staff until the start, edges", async (ctx) => {
    if (!prisma) return ctx.skip();
    expect((await setSettings("ownerA", { bookingCancelWindowMinutes: 120 })).status).toBe(200);
    const inside = await mkSession("batchOpen", 100); // starts in 100 min, window 120: closed
    const bIn = await book("parentA", inside.id, "kid");
    expect(bIn.status).toBe(201);
    const blocked = await cancel("parentA", bIn.body.id);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("conflict");
    expect(blocked.body.error.details[0].field).toBe("cancelWindow");
    expect(blocked.body.error.details[0].message).toBe(new Date(inside.startsAt.getTime() - 120 * 60_000).toISOString());
    expect(validateSchemaName(blocked.body, "Error")).toEqual([]);
    expect((await bookingRow(bIn.body.id)).status).toBe("BOOKED");
    // Coach (own session) and owner may cancel until the start.
    expect((await cancel("coachA2", bIn.body.id)).status).toBe(403);
    expect((await cancel("coachA", bIn.body.id)).status).toBe(200);

    const outside = await mkSession("batchOpen", 140); // 20 minutes before the window closes
    const bOut = await book("parentA", outside.id, "kid");
    expect(bOut.body.cancellableUntil).toBe(new Date(outside.startsAt.getTime() - 120 * 60_000).toISOString());
    expect((await cancel("parentA", bOut.body.id)).status).toBe(200);

    // Window 0: customers may cancel right up to the start; window 2880 (2 days) blocks a session 1 day away.
    expect((await setSettings("ownerA", { bookingCancelWindowMinutes: 0 })).status).toBe(200);
    const soon = await mkSession("batchOpen", 2);
    const bSoon = await book("parentA", soon.id, "kid");
    expect((await cancel("parentA", bSoon.body.id)).status).toBe(200);
    expect((await setSettings("ownerA", { bookingCancelWindowMinutes: 2880 })).status).toBe(200);
    const tomorrow = await mkSession("batchOpen", 60 * 24);
    const bTom = await book("parentA", tomorrow.id, "kid");
    expect((await cancel("parentA", bTom.body.id)).status).toBe(409);
    expect((await cancel("ownerA", bTom.body.id)).status).toBe(200);
    // Window changes apply immediately and take the exact boundary into account (>= window is allowed).
    expect((await setSettings("ownerA", { bookingCancelWindowMinutes: 120 })).status).toBe(200);

    // Nobody cancels after the start; a started session keeps its booking.
    const started = await mkSession("batchOpen", -5);
    const bst = await prisma.sessionBooking.create({
      data: { tenantId: (await prisma.session.findUniqueOrThrow({ where: { id: started.id } })).tenantId, sessionId: started.id, memberId: ids.kid, status: "BOOKED", bookedById: ids.ownerA },
    });
    expect((await cancel("ownerA", bst.id)).status).toBe(409);
    expect((await cancel("parentA", bst.id)).status).toBe(409);
    expect((await bookingRow(bst.id)).status).toBe("BOOKED");
  });

  it("booking confirmations: staff bookings write a feed entry for the member, own bookings do not", async (ctx) => {
    if (!prisma) return ctx.skip();
    const s = await mkSession("batchOpen", 60 * 24 * 10);
    const before = (await updates("kid", "BOOKING_CONFIRMED")).length;
    await book("parentA", s.id, "kid");
    expect((await updates("kid", "BOOKING_CONFIRMED")).length).toBe(before);
    const b = await book("coachA", s.id, "m6");
    const u = (await updates("m6", "BOOKING_CONFIRMED")).filter((x) => x.entityId === b.body.id);
    expect(u.length).toBe(1);
    expect(u[0]).toMatchObject({ entityType: "booking", actorId: ids.coachA });
  });

  describe("coach availability", () => {
    const slots = (extra: any[] = []) => [
      { weekday: 1, startTime: "06:00", endTime: "09:00" },
      { weekday: 1, startTime: "09:00", endTime: "11:00", venueId: undefined },
      { weekday: 3, startTime: "17:00", endTime: "19:30", venueId: "VENUE" },
      ...extra,
    ];
    const put = (who: string, coachKey: string, body: unknown) =>
      call(putAvailability, "PUT", `/coaches/${ids[coachKey]}/availability`, who, body, { coachId: ids[coachKey] });
    const get = (who: string, coachKey: string) =>
      call(getAvailability, "GET", `/coaches/${ids[coachKey]}/availability`, who, undefined, { coachId: ids[coachKey] });

    it("empty by default, replace-all semantics, sorted output, contract shape", async (ctx) => {
      if (!prisma) return ctx.skip();
      expect((await get("coachA", "coachA")).body).toEqual({ coachId: ids.coachA, slots: [] });
      const body = slots().map((s) => ({ ...s, venueId: s.venueId === "VENUE" ? ids.venueA : undefined }));
      const saved = await put("coachA", "coachA", { slots: [...body].reverse() });
      expect(saved.status).toBe(200);
      expect(validateSchemaName(saved.body, "CoachAvailability")).toEqual([]);
      expect(saved.body.slots.map((s: any) => [s.weekday, s.startTime, s.endTime, s.venueId])).toEqual([
        [1, "06:00", "09:00", null],
        [1, "09:00", "11:00", null], // touching slots are fine
        [3, "17:00", "19:30", ids.venueA],
      ]);
      expect((await get("ownerA", "coachA")).body.slots.length).toBe(3);
      const replaced = await put("ownerA", "coachA", { slots: [{ weekday: 5, startTime: "10:00", endTime: "12:00" }] });
      expect(replaced.body.slots.length).toBe(1);
      expect((await get("coachA", "coachA")).body.slots[0].weekday).toBe(5);
      expect((await put("coachA", "coachA", { slots: [] })).body.slots).toEqual([]);
    });

    it("rejects overlaps and malformed slots with 400 details and keeps the old data", async (ctx) => {
      if (!prisma) return ctx.skip();
      await put("coachA", "coachA", { slots: [{ weekday: 2, startTime: "08:00", endTime: "10:00" }] });
      const overlap = await put("coachA", "coachA", {
        slots: [
          { weekday: 4, startTime: "08:00", endTime: "10:00" },
          { weekday: 4, startTime: "09:59", endTime: "12:00" },
        ],
      });
      expect(overlap.status).toBe(400);
      expect(overlap.body.error.code).toBe("validation_failed");
      expect(overlap.body.error.details[0].field).toBe("slots[1]");
      expect(validateSchemaName(overlap.body, "Error")).toEqual([]);
      const bad: unknown[] = [
        {},
        { slots: "x" },
        { slots: [{ weekday: 0, startTime: "08:00", endTime: "09:00" }] },
        { slots: [{ weekday: 8, startTime: "08:00", endTime: "09:00" }] },
        { slots: [{ weekday: 1, startTime: "8:00", endTime: "09:00" }] },
        { slots: [{ weekday: 1, startTime: "08:00", endTime: "24:00" }] },
        { slots: [{ weekday: 1, startTime: "09:00", endTime: "09:00" }] },
        { slots: [{ weekday: 1, startTime: "10:00", endTime: "09:00" }] },
        { slots: [{ weekday: 1.5, startTime: "08:00", endTime: "09:00" }] },
        { slots: Array.from({ length: 51 }, () => ({ weekday: 1, startTime: "08:00", endTime: "09:00" })) },
        { slots: [{ weekday: 1, startTime: "08:00", endTime: "09:00", venueId: ids.venueB }] }, // other tenant's venue
        { slots: [{ weekday: 1, startTime: "08:00", endTime: "09:00", venueId: 7 }] },
      ];
      for (const b of bad) expect((await put("coachA", "coachA", b)).status, JSON.stringify(b).slice(0, 80)).toBe(400);
      expect((await get("coachA", "coachA")).body.slots.map((s: any) => s.weekday)).toEqual([2]);
    });

    it("roles and tenant isolation: coach only self, customers never, other tenant 404", async (ctx) => {
      if (!prisma) return ctx.skip();
      expect((await get("coachA2", "coachA")).status).toBe(403);
      expect((await put("coachA2", "coachA", { slots: [] })).status).toBe(403);
      expect((await get("parentA", "coachA")).status).toBe(403);
      expect((await put("adultU", "coachA", { slots: [] })).status).toBe(403);
      expect((await get("ownerB", "coachA")).status).toBe(404);
      expect((await put("ownerB", "coachA", { slots: [] })).status).toBe(404);
      expect((await get("coachB", "coachA")).status).toBe(404);
      expect((await get("ownerA", "coachB")).status).toBe(404);
      expect((await get("ownerA", "ownerA")).status).toBe(404); // not a coach
      expect((await call(getAvailability, "GET", "/coaches/zzz/availability", "ownerA", undefined, { coachId: "zzz" })).status).toBe(404);
    });
  });

  describe("tenant settings", () => {
    it("no row means defaults; update is partial and persists; response is the Tenant schema", async (ctx) => {
      if (!prisma) return ctx.skip();
      await prisma.tenantSettings.deleteMany({ where: { tenantId: { in: tenantIds } } });
      const def = await call(getTenant, "GET", "/tenant", "parentA");
      expect(def.status).toBe(200);
      expect(def.body).toMatchObject({ bookingCancelWindowMinutes: 120, waitlistEnabled: true, showMissedSessionCost: false, timezone: "Asia/Kolkata" });
      expect(validateSchemaName(def.body, "Tenant")).toEqual([]);

      const u = await setSettings("ownerA", { bookingCancelWindowMinutes: 45 });
      expect(u.status).toBe(200);
      expect(u.body).toMatchObject({ bookingCancelWindowMinutes: 45, waitlistEnabled: true, showMissedSessionCost: false });
      expect(validateSchemaName(u.body, "Tenant")).toEqual([]);
      const u2 = await setSettings("ownerA", { showMissedSessionCost: true, waitlistEnabled: false });
      expect(u2.body).toMatchObject({ bookingCancelWindowMinutes: 45, waitlistEnabled: false, showMissedSessionCost: true });
      for (const who of ["coachA", "parentA", "adultU"]) {
        expect((await call(getTenant, "GET", "/tenant", who)).body).toMatchObject({ bookingCancelWindowMinutes: 45, waitlistEnabled: false, showMissedSessionCost: true });
      }
      expect(await prisma.tenantSettings.count({ where: { tenantId: tenantIds[0] } })).toBe(1);
      expect((await setSettings("ownerA", { bookingCancelWindowMinutes: 0 })).body.bookingCancelWindowMinutes).toBe(0);
      expect((await setSettings("ownerA", { bookingCancelWindowMinutes: 2880 })).body.bookingCancelWindowMinutes).toBe(2880);
      await setSettings("ownerA", { bookingCancelWindowMinutes: 120, waitlistEnabled: true, showMissedSessionCost: false });
    });

    it("is isolated per tenant and owner only", async (ctx) => {
      if (!prisma) return ctx.skip();
      await setSettings("ownerA", { bookingCancelWindowMinutes: 33 });
      expect((await call(getTenant, "GET", "/tenant", "ownerB")).body.bookingCancelWindowMinutes).toBe(120);
      expect((await setSettings("ownerB", { bookingCancelWindowMinutes: 77 })).body.bookingCancelWindowMinutes).toBe(77);
      expect((await call(getTenant, "GET", "/tenant", "ownerA")).body.bookingCancelWindowMinutes).toBe(33);
      expect((await setSettings("coachA", { waitlistEnabled: false })).status).toBe(403);
      expect((await setSettings("parentA", { waitlistEnabled: false })).status).toBe(403);
      await setSettings("ownerA", { bookingCancelWindowMinutes: 120 });
    });

    it("validates the body", async (ctx) => {
      if (!prisma) return ctx.skip();
      const bad: unknown[] = [
        {},
        { bookingCancelWindowMinutes: -1 },
        { bookingCancelWindowMinutes: 2881 },
        { bookingCancelWindowMinutes: 1.5 },
        { bookingCancelWindowMinutes: "60" },
        { waitlistEnabled: "yes" },
        { showMissedSessionCost: 1 },
        { surprise: true },
      ];
      for (const b of bad) {
        const r = await setSettings("ownerA", b);
        expect(r.status, JSON.stringify(b)).toBe(400);
        expect(validateSchemaName(r.body, "Error")).toEqual([]);
      }
      const notJson = await putSettings(new Request("http://localhost/api/v1/tenant/settings", { method: "PUT", headers: { authorization: `Bearer ${tokens.ownerA}` }, body: "{nope" }));
      expect(notJson.status).toBe(400);
    });
  });
});
