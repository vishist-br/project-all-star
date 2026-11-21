import { Prisma } from "@prisma/client";
import { assertCanViewMember } from "../auth/access";
import { ApiError } from "../auth/errors";
import type { Principal } from "../auth/principal";
import type { TenantClient } from "../tenant-scope";
import { recordMemberUpdates } from "./member-updates";
import {
  buildSessionDetail,
  dateOnly,
  type Warning,
  loadSessionFor,
  sessionInclude,
  sessionWarnings,
  type Db,
  type SessionRow,
} from "./session-detail";

const MAX_DURATION_MS = 12 * 3_600_000;
const IST_MS = 330 * 60_000;

function fail(field: string, message: string): never {
  throw new ApiError("validation_failed", `${field}: ${message}`, [{ field, message }]);
}

function optString(body: Record<string, unknown>, field: string, max: number, min = 1): string | null | undefined {
  const v = body[field];
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string" || v.length < min || v.length > max) fail(field, `string of ${min}..${max} characters`);
  return v;
}

function optInt(body: Record<string, unknown>, field: string, min: number, max: number): number | null | undefined {
  const v = body[field];
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) fail(field, `integer ${min}..${max}`);
  return v;
}

export function parseDateTime(v: unknown, field: string): Date {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) fail(field, "ISO date-time required");
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) fail(field, "ISO date-time required");
  return d;
}

function checkWindow(startsAt: Date, endsAt: Date) {
  if (endsAt <= startsAt) fail("endsAt", "must be after startsAt");
  if (endsAt.getTime() - startsAt.getTime() > MAX_DURATION_MS) fail("endsAt", "a session lasts at most 12 hours");
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

function localParts(d: Date) {
  const iso = new Date(d.getTime() + IST_MS).toISOString();
  const weekday = ((new Date(iso.slice(0, 10)).getUTCDay() + 6) % 7) + 1;
  return { date: iso.slice(0, 10), time: iso.slice(11, 16), weekday };
}

async function assertNoOverlap(db: Db, coachId: string, startsAt: Date, endsAt: Date, excludeId?: string) {
  const clash = await db.session.findFirst({
    where: {
      coachId,
      status: "SCHEDULED",
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });
  if (clash) throw new ApiError("conflict", "This overlaps another scheduled session of the same coach");
}

async function assertCoach(db: Db, coachId: string) {
  const u = await db.user.findFirst({ where: { id: coachId, role: "COACH" }, select: { id: true } });
  if (!u) throw new ApiError("not_found", "Coach not found");
}

/** Finds, or creates, the coach's ONE_ON_ONE batch for a member. Returns the batch id. */
async function oneOnOneBatch(db: Db, tenantId: string, coachId: string, memberId: string, memberName: string, startsAt: Date, endsAt: Date) {
  const existing = await db.batch.findFirst({
    where: { coachId, kind: "ONE_ON_ONE", enrollments: { some: { memberId, leftOn: null } } },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing.id;
  const ref =
    (await db.batch.findFirst({
      where: { coachId, enrollments: { some: { memberId, leftOn: null } } },
      select: { venueId: true, sportId: true },
    })) ??
    (await db.batch.findFirst({ where: { coachId }, select: { venueId: true, sportId: true }, orderBy: { createdAt: "asc" } }));
  const venueId = ref?.venueId ?? (await db.venue.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } }))?.id;
  const sportId = ref?.sportId ?? (await db.sport.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } }))?.id;
  if (!venueId || !sportId) {
    throw new ApiError("validation_failed", "The tenant needs a venue and a sport before a one-on-one can be scheduled");
  }
  const a = localParts(startsAt);
  const b = localParts(endsAt);
  const batch = await db.batch.create({
    data: {
      tenantId,
      venueId,
      sportId,
      coachId,
      name: `One-on-one: ${memberName}`.slice(0, 120),
      kind: "ONE_ON_ONE",
      capacity: 1,
      daysOfWeek: [a.weekday],
      startTime: a.time,
      endTime: b.date === a.date ? b.time : "23:59",
    },
    select: { id: true },
  });
  await db.batchMember.create({ data: { tenantId, batchId: batch.id, memberId, ...(startsAt < new Date() ? { joinedOn: dateOnly(startsAt) } : {}) } });
  return batch.id;
}

function updateParams(s: Pick<SessionRow, "startsAt"> & { batch: { kind: string; name: string } }) {
  const p = localParts(s.startsAt);
  return { date: p.date, time: p.time, ...(s.batch.kind === "GROUP_CLASS" ? { batchName: s.batch.name } : {}) };
}

/** Members to notify about a session change: booked, waitlisted, and the one-on-one member. */
async function affectedMembers(db: Db, s: SessionRow): Promise<string[]> {
  const bookings = await db.sessionBooking.findMany({
    where: { sessionId: s.id, status: { in: ["BOOKED", "WAITLISTED"] } },
    select: { memberId: true },
  });
  const ids = bookings.map((b) => b.memberId);
  if (s.batch.kind === "ONE_ON_ONE") {
    const enrolled = await db.batchMember.findMany({ where: { batchId: s.batchId, leftOn: null }, select: { memberId: true } });
    ids.push(...enrolled.map((e) => e.memberId));
  }
  return [...new Set(ids)];
}

/** POST /sessions (createSession). */
export async function createSession(db: TenantClient, p: Principal, body: Record<string, unknown>) {
  const batchId = optString(body, "batchId", 100) ?? null;
  const memberId = optString(body, "memberId", 100) ?? null;
  const coachIdIn = optString(body, "coachId", 100) ?? null;
  const title = optString(body, "title", 80) ?? null;
  const clientId = optString(body, "clientId", 64, 1) ?? null;
  const capacity = optInt(body, "capacity", 1, 500) ?? null;
  if ((batchId === null) === (memberId === null)) {
    throw new ApiError("validation_failed", "Give exactly one of batchId or memberId", [
      { field: "batchId", message: "Either batchId or memberId" },
    ]);
  }
  const startsAt = parseDateTime(body.startsAt, "startsAt");
  const endsAt = parseDateTime(body.endsAt, "endsAt");
  checkWindow(startsAt, endsAt);
  if (memberId !== null && capacity !== null) fail("capacity", "not allowed for a one-on-one session");

  try {
    const id = await db.$transaction(async (tx) => {
      if (clientId) {
        const prior = await tx.session.findFirst({ where: { clientId }, select: { id: true, coachId: true } });
        if (prior) {
          if (p.role === "coach" && prior.coachId !== p.userId) throw new ApiError("conflict", "clientId is already used");
          return { id: prior.id, replay: true };
        }
      }
      let coachId: string;
      let useBatchId: string;
      if (batchId !== null) {
        const batch = await tx.batch.findFirst({ where: { id: batchId } });
        if (!batch) throw new ApiError("not_found", "Batch not found");
        if (p.role === "coach" && batch.coachId !== p.userId) throw new ApiError("forbidden", "This batch is outside your own view");
        if (!batch.isActive) throw new ApiError("conflict", "This batch is not active");
        if (batch.kind === "ONE_ON_ONE" && capacity !== null) fail("capacity", "not allowed for a one-on-one session");
        coachId = p.role === "coach" ? p.userId : (coachIdIn ?? batch.coachId);
        if (coachId !== batch.coachId) await assertCoach(tx, coachId);
        useBatchId = batch.id;
      } else {
        const member = await tx.member.findFirst({ where: { id: memberId! }, select: { id: true, displayName: true } });
        if (!member) throw new ApiError("not_found", "Member not found");
        await assertCanViewMember(tx as unknown as TenantClient, p, member.id);
        if (p.role === "coach") coachId = p.userId;
        else {
          const guess = coachIdIn ?? (await tx.batch.findFirst({ where: { enrollments: { some: { memberId: member.id, leftOn: null } } }, select: { coachId: true } }))?.coachId;
          if (!guess) fail("coachId", "required when the member has no coach yet");
          coachId = guess;
        }
        if (p.role !== "coach") await assertCoach(tx, coachId);
        await assertNoOverlap(tx, coachId, startsAt, endsAt);
        useBatchId = await oneOnOneBatch(tx, p.tenantId, coachId, member.id, member.displayName, startsAt, endsAt);
      }
      await assertNoOverlap(tx, coachId, startsAt, endsAt);
      const created = await tx.session.create({
        data: { tenantId: p.tenantId, batchId: useBatchId, coachId, startsAt, endsAt, capacity, title, clientId },
        include: sessionInclude,
      });
      if (memberId !== null) {
        await recordMemberUpdates(tx, {
          memberIds: [memberId],
          kind: "SESSION_SCHEDULED",
          entityType: "session",
          entityId: created.id,
          actorId: p.userId,
          params: updateParams(created),
        });
      }
      return { id: created.id, replay: false };
    });
    return db.$transaction(async (tx) => {
      const row = await loadSessionFor(tx, p, id.id);
      return buildSessionDetail(tx, p, row, id.replay ? [] : await sessionWarnings(tx, row));
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ApiError("conflict", "A session already exists at this time for this batch");
    throw err;
  }
}

/** PATCH /sessions/{sessionId} (updateSession). */
export async function updateSession(db: TenantClient, p: Principal, sessionId: string, body: Record<string, unknown>) {
  const known = ["startsAt", "endsAt", "status", "cancelReason", "coachNote", "capacity"];
  if (!known.some((k) => k in body)) {
    throw new ApiError("validation_failed", "Nothing to update", [{ field: "body", message: `One of ${known.join(", ")}` }]);
  }
  const startsIn = body.startsAt === undefined ? undefined : parseDateTime(body.startsAt, "startsAt");
  const endsIn = body.endsAt === undefined ? undefined : parseDateTime(body.endsAt, "endsAt");
  let cancel = false;
  if (body.status !== undefined) {
    if (body.status !== "cancelled") fail("status", "only 'cancelled' can be set");
    cancel = true;
  }
  const cancelReason = optString(body, "cancelReason", 200);
  if (cancelReason !== undefined && !cancel) fail("cancelReason", "only allowed together with status cancelled");
  const coachNote = optString(body, "coachNote", 1000);
  const capacity = optInt(body, "capacity", 1, 500);

  try {
    const warnings = await db.$transaction(async (tx): Promise<Warning[] | null> => {
      const s = await loadSessionFor(tx, p, sessionId);
      const timeChange =
        (startsIn !== undefined && startsIn.getTime() !== s.startsAt.getTime()) ||
        (endsIn !== undefined && endsIn.getTime() !== s.endsAt.getTime());
      const capChange = capacity !== undefined && capacity !== s.capacity;
      const data: Prisma.SessionUncheckedUpdateInput = {};
      if (coachNote !== undefined) data.coachNote = coachNote;

      if (s.status !== "SCHEDULED") {
        if (s.status === "COMPLETED" && (cancel || timeChange || capChange)) {
          throw new ApiError("conflict", "A completed session can only change its coach note");
        }
        if (s.status === "CANCELLED" && (timeChange || capChange)) {
          throw new ApiError("conflict", "A cancelled session can only change its coach note");
        }
        // Cancelling an already cancelled session is a no-op (safe to replay).
        if (Object.keys(data).length) await tx.session.update({ where: { id: s.id }, data });
        return [];
      }

      if (capacity !== undefined) {
        if (s.batch.kind === "ONE_ON_ONE" && capacity !== null) fail("capacity", "not allowed for a one-on-one session");
        data.capacity = capacity;
      }
      if (cancel && (timeChange || capChange)) {
        throw new ApiError("validation_failed", "Cancel on its own, without rescheduling");
      }
      if (cancel) {
        const who = await affectedMembers(tx, s);
        data.status = "CANCELLED";
        data.cancelledAt = new Date();
        data.cancelReason = cancelReason ?? null;
        await tx.sessionBooking.updateMany({
          where: { sessionId: s.id, status: { in: ["BOOKED", "WAITLISTED"] } },
          data: { status: "CANCELLED", waitlistPosition: null, cancelledAt: new Date() },
        });
        await recordMemberUpdates(tx, {
          memberIds: who,
          kind: "SESSION_CANCELLED",
          entityType: "session",
          entityId: s.id,
          actorId: p.userId,
          params: updateParams(s),
        });
      } else if (timeChange) {
        const startsAt = startsIn ?? s.startsAt;
        const endsAt = endsIn ?? s.endsAt;
        checkWindow(startsAt, endsAt);
        await assertNoOverlap(tx, s.coachId, startsAt, endsAt, s.id);
        data.startsAt = startsAt;
        data.endsAt = endsAt;
        const who = await affectedMembers(tx, s);
        await recordMemberUpdates(tx, {
          memberIds: who,
          kind: "SESSION_RESCHEDULED",
          entityType: "session",
          entityId: s.id,
          actorId: p.userId,
          params: updateParams({ startsAt, batch: s.batch }),
        });
      }
      if (Object.keys(data).length) await tx.session.update({ where: { id: s.id }, data });
      return null;
    });

    return await db.$transaction(async (tx) => {
      const row = await loadSessionFor(tx, p, sessionId);
      let w = warnings;
      if (w === null) {
        const booked = await tx.sessionBooking.count({ where: { sessionId: row.id, status: "BOOKED" } });
        w = row.status === "CANCELLED" ? [] : await sessionWarnings(tx, row, booked);
      }
      return buildSessionDetail(tx, p, row, w);
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ApiError("conflict", "A session already exists at this time for this batch");
    throw err;
  }
}
