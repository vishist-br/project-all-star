import type { Prisma } from "@prisma/client";
import { memberWhere, sessionWhere } from "../auth/access";
import { ApiError } from "../auth/errors";
import type { Principal } from "../auth/principal";
import type { TenantClient } from "../tenant-scope";
import { pickDeclaration, preMarkClientId, type Declaration } from "../absences/rules";
import { tenantDate } from "./pagination";

/** A tenant-scoped client or an interactive-transaction client derived from one. */
export type Db = Parameters<Parameters<TenantClient["$transaction"]>[0]>[0];

export type Warning = { code: "outside_availability" | "over_capacity" | "on_holiday"; message: string };
type AttendanceDto = "present" | "absent" | "excused" | "not_marked";
type ReasonDto = "exam" | "illness" | "festival" | "travel";

export type RosterEntryDto = {
  memberId: string;
  memberName: string;
  source: "enrolled" | "booked" | "waitlisted";
  bookingId: string | null;
  attendance: AttendanceDto;
  excusedReason: ReasonDto | null;
  note: string | null;
  attendanceClientId: string | null;
  /** STAR-95: true when "excused" is shown only because the member or parent declared the absence in advance (no roll call row yet). */
  preMarked: boolean;
  /** STAR-95: reason and note the member or parent gave ahead of time, null when nothing was declared. */
  declaredReason: ReasonDto | null;
  declaredNote: string | null;
};

export const sessionInclude = {
  batch: { select: { name: true, venueId: true, kind: true, capacity: true, venue: { select: { name: true } } } },
  coach: { select: { name: true } },
} satisfies Prisma.SessionInclude;
export type SessionRow = Prisma.SessionGetPayload<{ include: typeof sessionInclude }>;

/** Tenant-calendar date of an instant as a UTC-midnight Date (matches `@db.Date` columns). */
export function dateOnly(d: Date): Date {
  return new Date(`${tenantDate(d)}T00:00:00.000Z`);
}

/** Loads a session in the caller's view: 404 outside the tenant, 403 inside it but not theirs. */
export async function loadSessionFor(db: Db, p: Principal, sessionId: string): Promise<SessionRow> {
  const row = await db.session.findFirst({ where: { id: sessionId }, include: sessionInclude });
  if (!row) throw new ApiError("not_found", "Session not found");
  const visible = await db.session.findFirst({ where: { id: sessionId, ...sessionWhere(p) }, select: { id: true } });
  if (!visible) throw new ApiError("forbidden", "This session is outside your own view");
  return row;
}

export async function isHoliday(db: Db, startsAt: Date): Promise<boolean> {
  return (await db.holiday.findFirst({ where: { date: dateOnly(startsAt) }, select: { id: true } })) !== null;
}

/** Active declarations (STAR-95) that cover this session, one per member (the most specific wins). */
export async function loadSessionDeclarations(db: Db, s: SessionRow): Promise<Map<string, Declaration>> {
  const day = dateOnly(s.startsAt);
  const date = day.toISOString().slice(0, 10);
  const rows = await db.excusedAbsence.findMany({
    where: { cancelledAt: null, fromDate: { lte: day }, toDate: { gte: day }, OR: [{ sessionId: null }, { sessionId: s.id }] },
    select: { id: true, memberId: true, fromDate: true, toDate: true, sessionId: true, reason: true, note: true },
    orderBy: { id: "asc" },
  });
  const byMember = new Map<string, Declaration[]>();
  for (const r of rows) {
    const d: Declaration = {
      id: r.id,
      fromDate: r.fromDate.toISOString().slice(0, 10),
      toDate: r.toDate.toISOString().slice(0, 10),
      sessionId: r.sessionId,
      reason: r.reason.toLowerCase() as Declaration["reason"],
      note: r.note,
      withdrawn: false,
    };
    byMember.set(r.memberId, [...(byMember.get(r.memberId) ?? []), d]);
  }
  const out = new Map<string, Declaration>();
  for (const [memberId, list] of byMember) {
    const hit = pickDeclaration(list, { id: s.id, date });
    if (hit) out.set(memberId, hit);
  }
  return out;
}

/** Everyone who belongs on this session's roll call, with their current attendance. */
export async function loadRoster(db: Db, s: SessionRow): Promise<RosterEntryDto[]> {
  const day = dateOnly(s.startsAt);
  const [enrolled, bookings, attendance, declared] = await Promise.all([
    db.batchMember.findMany({
      where: { batchId: s.batchId, joinedOn: { lte: day }, OR: [{ leftOn: null }, { leftOn: { gte: day } }] },
      select: { member: { select: { id: true, displayName: true } } },
    }),
    db.sessionBooking.findMany({
      where: { sessionId: s.id, status: { not: "CANCELLED" } },
      select: { id: true, status: true, member: { select: { id: true, displayName: true } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    db.attendance.findMany({
      where: { sessionId: s.id },
      select: { memberId: true, status: true, reason: true, note: true, clientId: true, member: { select: { displayName: true } } },
    }),
    loadSessionDeclarations(db, s),
  ]);
  const att = new Map(attendance.map((a) => [a.memberId, a]));
  const bookingBy = new Map(bookings.map((b) => [b.member.id, b]));
  const out = new Map<string, RosterEntryDto>();
  const entry = (id: string, name: string, source: RosterEntryDto["source"], bookingId: string | null): RosterEntryDto => {
    const a = att.get(id);
    const dec = declared.get(id) ?? null;
    // A roll call mark always wins; a declaration only fills in members nobody has marked yet.
    const pre = !a && dec !== null;
    return {
      memberId: id,
      memberName: name,
      source,
      bookingId,
      attendance: a ? (a.status.toLowerCase() as AttendanceDto) : pre ? "excused" : "not_marked",
      excusedReason: a?.reason ? (a.reason.toLowerCase() as ReasonDto) : pre ? dec.reason : null,
      note: a?.note ?? null,
      attendanceClientId: a?.clientId ?? (pre ? preMarkClientId(dec.id, s.id) : null),
      preMarked: pre,
      declaredReason: dec?.reason ?? null,
      declaredNote: dec?.note ?? null,
    };
  };
  for (const e of [...enrolled].sort((x, y) => x.member.displayName.localeCompare(y.member.displayName))) {
    out.set(e.member.id, entry(e.member.id, e.member.displayName, "enrolled", bookingBy.get(e.member.id)?.id ?? null));
  }
  for (const b of bookings) {
    if (out.has(b.member.id)) continue;
    out.set(b.member.id, entry(b.member.id, b.member.displayName, b.status === "BOOKED" ? "booked" : "waitlisted", b.id));
  }
  for (const a of attendance) {
    if (!out.has(a.memberId)) out.set(a.memberId, entry(a.memberId, a.member.displayName, "enrolled", null));
  }
  return [...out.values()];
}

export async function sessionWarnings(db: Db, s: SessionRow, bookedCount?: number): Promise<Warning[]> {
  const warnings: Warning[] = [];
  const rows = await db.coachAvailability.findMany({ where: { coachId: s.coachId } });
  if (rows.length > 0) {
    const local = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString();
    const startL = local(s.startsAt);
    const endL = local(s.endsAt);
    const weekday = ((new Date(startL.slice(0, 10)).getUTCDay() + 6) % 7) + 1;
    const st = startL.slice(11, 16);
    const en = endL.slice(0, 10) === startL.slice(0, 10) ? endL.slice(11, 16) : "99:99";
    const ok = rows.some((r) => r.weekday === weekday && r.startTime <= st && r.endTime >= en);
    if (!ok) warnings.push({ code: "outside_availability", message: "This session is outside the coach's weekly availability" });
  }
  if (await isHoliday(db, s.startsAt)) warnings.push({ code: "on_holiday", message: "This date is on the holiday calendar" });
  const cap = s.capacity ?? s.batch.capacity;
  if (cap !== null && bookedCount !== undefined && bookedCount > cap) {
    warnings.push({ code: "over_capacity", message: "More members are booked than the capacity" });
  }
  return warnings;
}

/** SessionDetail per the contract. Owners and coaches get the roster, customers only their own rows. */
export async function buildSessionDetail(db: Db, p: Principal, s: SessionRow, warnings?: Warning[]) {
  const [roster, bookings, holiday, settings] = await Promise.all([
    loadRoster(db, s),
    db.sessionBooking.findMany({
      where: { sessionId: s.id },
      select: {
        id: true,
        memberId: true,
        status: true,
        waitlistPosition: true,
        createdAt: true,
        cancelledAt: true,
        member: { select: { displayName: true } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    isHoliday(db, s.startsAt),
    p.role === "customer" ? db.tenantSettings.findFirst({ select: { bookingCancelWindowMinutes: true } }) : null,
  ]);
  const bookedCount = bookings.filter((b) => b.status === "BOOKED").length;
  const waitlistCount = bookings.filter((b) => b.status === "WAITLISTED").length;
  const summary = { present: 0, absent: 0, excused: 0, total: 0 };
  for (const r of roster) {
    if (r.attendance === "not_marked" || r.preMarked) continue;
    summary[r.attendance] += 1;
    summary.total += 1;
  }

  const detail: Record<string, unknown> = {
    id: s.id,
    batchId: s.batchId,
    batchName: s.batch.name,
    coachId: s.coachId,
    coachName: s.coach.name,
    venueId: s.batch.venueId,
    venueName: s.batch.venue.name,
    startsAt: s.startsAt.toISOString(),
    endsAt: s.endsAt.toISOString(),
    status: s.status.toLowerCase(),
    attendanceSummary: summary.total > 0 ? summary : null,
    coachNote: s.coachNote,
    kind: s.batch.kind === "ONE_ON_ONE" ? "one_on_one" : "group_class",
    title: s.title,
    capacity: s.capacity ?? s.batch.capacity,
    bookedCount,
    waitlistCount,
    isHoliday: holiday,
    cancelReason: s.cancelReason,
  };
  if (warnings) detail.warnings = warnings;

  if (p.role === "customer") {
    const mine = new Set((await db.member.findMany({ where: memberWhere(p), select: { id: true } })).map((m) => m.id));
    const cancelWindow = (settings?.bookingCancelWindowMinutes ?? 120) * 60_000;
    const myBookings = bookings.filter((b) => mine.has(b.memberId));
    detail.myBookings = myBookings.map((b) => ({
      id: b.id,
      sessionId: s.id,
      memberId: b.memberId,
      memberName: b.member.displayName,
      status: b.status.toLowerCase(),
      waitlistPosition: b.waitlistPosition,
      createdAt: b.createdAt.toISOString(),
      cancelledAt: b.cancelledAt?.toISOString() ?? null,
      cancellableUntil: b.status === "CANCELLED" ? null : new Date(s.startsAt.getTime() - cancelWindow).toISOString(),
    }));
    detail.myAttendance = roster
      .filter((r) => mine.has(r.memberId))
      .map((r) => ({ memberId: r.memberId, attendance: r.preMarked ? ("not_marked" as const) : r.attendance }));
    const live = myBookings.find((b) => b.status !== "CANCELLED") ?? myBookings[0];
    detail.myBookingStatus = live ? live.status.toLowerCase() : null;
    // Customers see counts only, never who else is marked.
    detail.attendanceSummary = null;
  } else {
    detail.roster = roster;
  }
  return detail;
}

/** GET /sessions/{sessionId} (getSession). */
export async function getSession(db: TenantClient, p: Principal, sessionId: string) {
  const row = await loadSessionFor(db as unknown as Db, p, sessionId);
  return buildSessionDetail(db as unknown as Db, p, row);
}
