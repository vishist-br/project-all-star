import { assertCanViewMember } from "@/lib/auth/access";
import type { Principal } from "@/lib/auth/principal";
import type { TenantClient } from "@/lib/tenant-scope";
import { cancellableUntil } from "./schedule";

export type MyBooking = {
  bookingId: string;
  status: "booked" | "waitlisted";
  waitlistPosition: number | null;
  cancellableUntil: string;
};

/**
 * The member's live (booked or waitlisted) bookings for some sessions: booking id (to cancel),
 * waiting-list position and the cancellation deadline. getMemberSchedule only reports the status,
 * so this reads the member's own bookings through the same viewer checks.
 */
export async function loadMyBookings(
  db: TenantClient,
  p: Principal,
  memberId: string,
  sessions: { id: string; startsAt: string }[],
  windowMinutes: number,
): Promise<Map<string, MyBooking>> {
  await assertCanViewMember(db, p, memberId);
  const out = new Map<string, MyBooking>();
  if (sessions.length === 0) return out;
  const starts = new Map(sessions.map((s) => [s.id, s.startsAt]));
  const rows = await db.sessionBooking.findMany({
    where: { memberId, sessionId: { in: sessions.map((s) => s.id) }, status: { in: ["BOOKED", "WAITLISTED"] } },
    select: { id: true, sessionId: true, status: true, waitlistPosition: true },
  });
  for (const r of rows) {
    out.set(r.sessionId, {
      bookingId: r.id,
      status: r.status === "BOOKED" ? "booked" : "waitlisted",
      waitlistPosition: r.waitlistPosition,
      cancellableUntil: cancellableUntil(starts.get(r.sessionId)!, windowMinutes),
    });
  }
  return out;
}
