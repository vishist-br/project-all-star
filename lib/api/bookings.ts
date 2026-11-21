import { bookingWhere, memberWhere } from "../auth/access";
import { ApiError } from "../auth/errors";
import type { Principal } from "../auth/principal";
import type { TenantClient } from "../tenant-scope";
import { recordMemberUpdates } from "./member-updates";
import { dateOnly, loadSessionFor, type Db, type SessionRow } from "./session-detail";
import { loadTenantSettings } from "./tenant-settings";

const IST_MS = 330 * 60_000;

export type BookingDto = {
  id: string;
  sessionId: string;
  memberId: string;
  memberName: string;
  status: "booked" | "waitlisted" | "cancelled";
  waitlistPosition: number | null;
  createdAt: string;
  cancelledAt: string | null;
  cancellableUntil: string | null;
};

type BookingRow = {
  id: string;
  sessionId: string;
  memberId: string;
  status: "BOOKED" | "WAITLISTED" | "CANCELLED";
  waitlistPosition: number | null;
  createdAt: Date;
  cancelledAt: Date | null;
  member: { displayName: string };
};

const bookingInclude = { member: { select: { displayName: true } } } as const;

function toDto(b: BookingRow, startsAt: Date, windowMinutes: number, p: Principal): BookingDto {
  return {
    id: b.id,
    sessionId: b.sessionId,
    memberId: b.memberId,
    memberName: b.member.displayName,
    status: b.status.toLowerCase() as BookingDto["status"],
    waitlistPosition: b.waitlistPosition,
    createdAt: b.createdAt.toISOString(),
    cancelledAt: b.cancelledAt?.toISOString() ?? null,
    cancellableUntil:
      p.role === "customer" && b.status !== "CANCELLED"
        ? new Date(startsAt.getTime() - windowMinutes * 60_000).toISOString()
        : null,
  };
}

/** Serialises bookings of one session: concurrent book/cancel calls queue on this row lock. */
async function lockSession(tx: Db, sessionId: string, tenantId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM sessions WHERE id = ${sessionId} AND tenant_id = ${tenantId} FOR UPDATE`;
}

function capacityOf(s: SessionRow): number | null {
  return s.capacity ?? s.batch.capacity;
}

function updateParams(s: SessionRow) {
  const iso = new Date(s.startsAt.getTime() + IST_MS).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16), batchName: s.batch.name };
}

function fail(field: string, message: string): never {
  throw new ApiError("validation_failed", `${field}: ${message}`, [{ field, message }]);
}

/** Renumbers the waitlist to 1..n in FIFO order. */
async function renumberWaitlist(tx: Db, sessionId: string): Promise<void> {
  const rows = await tx.sessionBooking.findMany({
    where: { sessionId, status: "WAITLISTED" },
    select: { id: true, waitlistPosition: true },
    orderBy: [{ waitlistPosition: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  for (const [i, r] of rows.entries()) {
    if (r.waitlistPosition !== i + 1) {
      await tx.sessionBooking.update({ where: { id: r.id }, data: { waitlistPosition: i + 1 } });
    }
  }
}

/** Fills free places from the front of the waitlist; writes `waitlist_promoted` updates. */
async function promoteWaitlist(tx: Db, s: SessionRow, actorId: string): Promise<void> {
  const cap = capacityOf(s);
  for (;;) {
    const booked = await tx.sessionBooking.count({ where: { sessionId: s.id, status: "BOOKED" } });
    if (cap !== null && booked >= cap) break;
    const next = await tx.sessionBooking.findFirst({
      where: { sessionId: s.id, status: "WAITLISTED" },
      orderBy: [{ waitlistPosition: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: { id: true, memberId: true },
    });
    if (!next) break;
    await tx.sessionBooking.update({ where: { id: next.id }, data: { status: "BOOKED", waitlistPosition: null } });
    await recordMemberUpdates(tx, {
      memberIds: [next.memberId],
      kind: "WAITLIST_PROMOTED",
      entityType: "booking",
      entityId: next.id,
      actorId,
      params: updateParams(s),
    });
  }
  await renumberWaitlist(tx, s.id);
}

/** POST /sessions/{sessionId}/bookings (bookSession). */
export async function bookSession(db: TenantClient, p: Principal, sessionId: string, body: Record<string, unknown>) {
  const memberId = body.memberId;
  if (typeof memberId !== "string" || memberId.length === 0 || memberId.length > 100) {
    fail("memberId", "required string");
  }
  const mid = memberId as string;

  return db.$transaction(async (tx) => {
    await lockSession(tx, sessionId, p.tenantId);
    const s = await loadSessionFor(tx, p, sessionId); // 404 outside tenant, 403 outside own view

    const member = await tx.member.findFirst({ where: { id: mid }, select: { id: true, isActive: true, leftOn: true } });
    if (!member) throw new ApiError("not_found", "Member not found");
    if (p.role === "customer") {
      const own = await tx.member.findFirst({ where: { id: mid, ...memberWhere(p) }, select: { id: true } });
      if (!own) throw new ApiError("forbidden", "You can only book for yourself or your children");
      const day = dateOnly(s.startsAt);
      const enrolled = await tx.batchMember.findFirst({
        where: { batchId: s.batchId, memberId: mid, joinedOn: { lte: day }, OR: [{ leftOn: null }, { leftOn: { gte: day } }] },
        select: { id: true },
      });
      if (!enrolled) throw new ApiError("forbidden", "This member is not enrolled in this class");
    }

    if (s.batch.kind !== "GROUP_CLASS") throw new ApiError("conflict", "Only group-class sessions take bookings");
    if (s.status !== "SCHEDULED") throw new ApiError("conflict", "This session is not open for booking");
    if (s.startsAt.getTime() <= Date.now()) throw new ApiError("conflict", "This session has already started");
    if (!member.isActive || member.leftOn !== null) throw new ApiError("conflict", "This member is not active");

    const existing = await tx.sessionBooking.findFirst({ where: { sessionId: s.id, memberId: mid }, select: { id: true, status: true } });
    if (existing && existing.status !== "CANCELLED") {
      throw new ApiError("conflict", "This member already holds a booking for this session");
    }

    const settings = await loadTenantSettings(tx);
    const cap = capacityOf(s);
    const booked = await tx.sessionBooking.count({ where: { sessionId: s.id, status: "BOOKED" } });
    const full = cap !== null && booked >= cap;
    if (full && !settings.waitlistEnabled) throw new ApiError("conflict", "This session is full");

    let status: "BOOKED" | "WAITLISTED" = "BOOKED";
    let waitlistPosition: number | null = null;
    if (full) {
      status = "WAITLISTED";
      waitlistPosition = (await tx.sessionBooking.count({ where: { sessionId: s.id, status: "WAITLISTED" } })) + 1;
    }

    // Re-booking after a cancellation reuses the row and goes to the back of the queue.
    const data = { status, waitlistPosition, bookedById: p.userId, cancelledAt: null, createdAt: new Date() };
    const row = existing
      ? await tx.sessionBooking.update({ where: { id: existing.id }, data, include: bookingInclude })
      : await tx.sessionBooking.create({
          data: { tenantId: p.tenantId, sessionId: s.id, memberId: mid, ...data },
          include: bookingInclude,
        });

    // Customers already see their own confirmation; tell the member when staff booked for them.
    if (status === "BOOKED" && p.role !== "customer") {
      await recordMemberUpdates(tx, {
        memberIds: [mid],
        kind: "BOOKING_CONFIRMED",
        entityType: "booking",
        entityId: row.id,
        actorId: p.userId,
        params: updateParams(s),
      });
    }
    const windowMinutes = settings.bookingCancelWindowMinutes;
    return toDto(row, s.startsAt, windowMinutes, p);
  });
}

/** POST /bookings/{bookingId}/cancel (cancelBooking). Cancelling twice is a safe no-op. */
export async function cancelBooking(db: TenantClient, p: Principal, bookingId: string) {
  const peek = await db.sessionBooking.findFirst({ where: { id: bookingId }, select: { sessionId: true } });
  if (!peek) throw new ApiError("not_found", "Booking not found");

  return db.$transaction(async (tx) => {
    await lockSession(tx, peek.sessionId, p.tenantId);
    const b = await tx.sessionBooking.findFirst({ where: { id: bookingId }, include: bookingInclude });
    if (!b) throw new ApiError("not_found", "Booking not found");
    const visible = await tx.sessionBooking.findFirst({ where: { id: bookingId, ...bookingWhere(p) }, select: { id: true } });
    if (!visible) throw new ApiError("forbidden", "This booking is outside your own view");
    const s = await loadSessionFor(tx, { ...p, role: "owner" }, b.sessionId);
    const settings = await loadTenantSettings(tx);
    const windowMinutes = settings.bookingCancelWindowMinutes;

    if (b.status === "CANCELLED") return toDto(b, s.startsAt, windowMinutes, p);

    const now = Date.now();
    if (s.startsAt.getTime() <= now) throw new ApiError("conflict", "This session has already started");
    if (p.role === "customer") {
      const until = new Date(s.startsAt.getTime() - windowMinutes * 60_000);
      if (now > until.getTime()) {
        throw new ApiError("conflict", `Bookings can only be cancelled until ${windowMinutes} minutes before the session`, [
          { field: "cancelWindow", message: until.toISOString() },
        ]);
      }
    }

    const cancelled = await tx.sessionBooking.update({
      where: { id: b.id },
      data: { status: "CANCELLED", waitlistPosition: null, cancelledAt: new Date() },
      include: bookingInclude,
    });
    if (b.status === "BOOKED") await promoteWaitlist(tx, s, p.userId);
    else await renumberWaitlist(tx, s.id);
    return toDto(cancelled, s.startsAt, windowMinutes, p);
  });
}
