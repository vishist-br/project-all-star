// Pure view-model helpers for the customer Schedule screen (STAR-70): no database, no React.

export type BookingState = "booked" | "waitlisted" | "cancelled" | null;

export type SessionLike = {
  id: string;
  startsAt: string;
  status: "scheduled" | "completed" | "cancelled";
  kind: "group_class" | "one_on_one";
  capacity: number | null;
  bookedCount: number;
  waitlistCount: number;
  myBookingStatus: BookingState;
};

/** Places left in a session; null when the session has no capacity limit. Never negative. */
export function spotsLeft(s: Pick<SessionLike, "capacity" | "bookedCount">): number | null {
  return s.capacity === null ? null : Math.max(0, s.capacity - s.bookedCount);
}

export type SessionAction =
  /** Hold a place now. */
  | "book"
  /** The class is full; join the waiting list. */
  | "waitlist"
  /** Full and the business has no waiting list. */
  | "full"
  /** Already booked or waitlisted: only cancelling is possible. */
  | "manage"
  /** Nothing to do (past, cancelled, one-to-one, completed). */
  | "none";

/** What the member can do with a session right now. Mirrors the rules of bookSession in lib/api/bookings.ts. */
export function sessionAction(s: SessionLike, now: Date, waitlistEnabled: boolean): SessionAction {
  if (s.kind !== "group_class" || s.status !== "scheduled") return "none";
  if (new Date(s.startsAt).getTime() <= now.getTime()) return "none";
  if (s.myBookingStatus === "booked" || s.myBookingStatus === "waitlisted") return "manage";
  const left = spotsLeft(s);
  if (left !== null && left === 0) return waitlistEnabled ? "waitlist" : "full";
  return "book";
}

/**
 * Cancellation deadline of a booking: the start minus the tenant's window. This is the same formula
 * the API uses for `cancellableUntil` (lib/api/bookings.ts toDto) for the booking list on this screen.
 */
export function cancellableUntil(startsAt: string, windowMinutes: number): string {
  return new Date(new Date(startsAt).getTime() - windowMinutes * 60_000).toISOString();
}

/** Whether a cancel is still allowed. A missing deadline (older data) counts as open; the server decides. */
export function cancelOpen(until: string | null, now: Date): boolean {
  return until === null || now.getTime() <= new Date(until).getTime();
}

/** The deadline the API hands back in the 409 `cancelWindow` detail, or null. */
export function cancelWindowFrom(details: { field: string; message: string }[] | undefined): string | null {
  const d = details?.find((x) => x.field === "cancelWindow")?.message;
  return d && !Number.isNaN(new Date(d).getTime()) ? d : null;
}

export type BookingFailure = "closedWindow" | "full" | "started" | "already" | "notEnrolled" | "notOpen" | "other";

/** Maps an API error (code, message, details) from book/cancel to a friendly reason; the UI turns it into text. */
export function failureReason(code: string, message: string, details?: { field: string; message: string }[]): BookingFailure {
  if (cancelWindowFrom(details)) return "closedWindow";
  if (code === "conflict") {
    if (/already started/i.test(message)) return "started";
    if (/already holds/i.test(message)) return "already";
    if (/full/i.test(message)) return "full";
    if (/not open|only group/i.test(message)) return "notOpen";
    return "other";
  }
  if (code === "forbidden" && /enrolled/i.test(message)) return "notEnrolled";
  return "other";
}

// ---- calendar helpers (plain YYYY-MM-DD dates) ----

export function addDaysTo(date: string, n: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
}

/** Monday = 1 .. Sunday = 7. */
export function isoWeekdayOf(date: string): number {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

export function isDate(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime());
}

export function isMonth(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

export function monthRange(month: string): { from: string; to: string } {
  const from = `${month}-01`;
  const next = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1));
  return { from, to: addDaysTo(next.toISOString().slice(0, 10), -1) };
}

export function shiftMonth(month: string, delta: number): string {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

/** Weeks (Monday first) of a month as rows of 7 cells; days outside the month are null. */
export function monthGrid(month: string): (string | null)[][] {
  const { from, to } = monthRange(month);
  const cells: (string | null)[] = Array.from({ length: isoWeekdayOf(from) - 1 }, () => null);
  for (let d = from; d <= to; d = addDaysTo(d, 1)) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const rows: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

/** Sessions that still matter to the member on a day: shown first, soonest first. */
export function sortSessions<T extends { startsAt: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0));
}
