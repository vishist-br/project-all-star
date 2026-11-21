"use server";
import { ApiError } from "@/lib/auth/errors";
import { bookSession, cancelBooking } from "@/lib/api/bookings";
import { allow, getCustomerContext } from "@/lib/customer/server";
import { cancelWindowFrom, failureReason, type BookingFailure } from "@/lib/customer/schedule";

export type BookingResult =
  | { ok: true; status: "booked" | "waitlisted" | "cancelled"; waitlistPosition: number | null; cancellableUntil: string | null }
  | { ok: false; reason: BookingFailure; until: string | null };

function fail(err: unknown): BookingResult {
  if (err instanceof ApiError) {
    return { ok: false, reason: failureReason(err.code, err.message, err.details), until: cancelWindowFrom(err.details) };
  }
  throw err;
}

/** Book (or join the waiting list of) a session for the chosen member. The viewer principal comes from the session, never from the browser. */
export async function bookSessionAction(sessionId: string, memberId: string): Promise<BookingResult> {
  try {
    const { principal, db, children } = await getCustomerContext();
    if (!children.some((c) => c.id === memberId)) return { ok: false, reason: "other", until: null };
    allow(principal, "bookSession");
    const b = await bookSession(db, principal, sessionId, { memberId });
    return { ok: true, status: b.status, waitlistPosition: b.waitlistPosition, cancellableUntil: b.cancellableUntil };
  } catch (err) {
    return fail(err);
  }
}

/** Cancel a booking or waiting-list place. After the cancellation window the API answers 409 with the deadline, which is passed back for a friendly message. */
export async function cancelBookingAction(bookingId: string): Promise<BookingResult> {
  try {
    const { principal, db } = await getCustomerContext();
    allow(principal, "cancelBooking");
    const b = await cancelBooking(db, principal, bookingId);
    return { ok: true, status: b.status, waitlistPosition: b.waitlistPosition, cancellableUntil: b.cancellableUntil };
  } catch (err) {
    return fail(err);
  }
}
