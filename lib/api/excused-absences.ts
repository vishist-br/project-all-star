import type { ExcuseReason, Prisma } from "@prisma/client";
import { assertCanViewMember, memberWhere, sessionWhere } from "../auth/access";
import { ApiError } from "../auth/errors";
import type { Principal } from "../auth/principal";
import type { TenantClient } from "../tenant-scope";
import { ABSENCE_REASONS, MAX_NOTE_LENGTH, MAX_RANGE_DAYS, daysInRange } from "../absences/rules";
import { Problems, dateFromDb, dateToDb, isDateString } from "../workouts/validate";
import { tenantDate } from "./pagination";

export type ExcusedAbsenceDto = {
  id: string;
  memberId: string;
  memberName: string;
  sessionId: string | null;
  fromDate: string;
  toDate: string;
  reason: (typeof ABSENCE_REASONS)[number];
  note: string | null;
  status: "active" | "withdrawn";
  createdAt: string;
  cancelledAt: string | null;
};

const include = { member: { select: { displayName: true } } } satisfies Prisma.ExcusedAbsenceInclude;
type Row = Prisma.ExcusedAbsenceGetPayload<{ include: typeof include }>;

function toDto(r: Row): ExcusedAbsenceDto {
  return {
    id: r.id,
    memberId: r.memberId,
    memberName: r.member.displayName,
    sessionId: r.sessionId,
    fromDate: dateFromDb(r.fromDate),
    toDate: dateFromDb(r.toDate),
    reason: r.reason.toLowerCase() as ExcusedAbsenceDto["reason"],
    note: r.note,
    status: r.cancelledAt ? "withdrawn" : "active",
    createdAt: r.createdAt.toISOString(),
    cancelledAt: r.cancelledAt?.toISOString() ?? null,
  };
}

/** GET /members/{memberId}/excused-absences (listExcusedAbsences). Active declarations ending today or later, soonest first. `status=all` adds withdrawn and past ones. */
export async function listExcusedAbsences(db: TenantClient, p: Principal, memberId: string, params: URLSearchParams) {
  await assertCanViewMember(db, p, memberId);
  const status = params.get("status");
  if (status !== null && status !== "" && status !== "active" && status !== "all") {
    throw new ApiError("validation_failed", "status must be active or all", [{ field: "status", message: "One of active, all" }]);
  }
  const where: Prisma.ExcusedAbsenceWhereInput =
    status === "all" ? { memberId } : { memberId, cancelledAt: null, toDate: { gte: dateToDb(tenantDate(new Date())) } };
  const rows = await db.excusedAbsence.findMany({
    where,
    include,
    orderBy: [{ fromDate: "asc" }, { id: "asc" }],
    take: 200,
  });
  return { items: rows.map(toDto) };
}

/** POST /members/{memberId}/excused-absences (createExcusedAbsence). */
export async function createExcusedAbsence(db: TenantClient, p: Principal, memberId: string, body: Record<string, unknown>) {
  await assertCanViewMember(db, p, memberId);
  const problems = new Problems();
  const today = tenantDate(new Date());

  const reason = ABSENCE_REASONS.find((r) => r === body.reason);
  if (!reason) problems.add("reason", `One of ${ABSENCE_REASONS.join(", ")}`);
  let note: string | null = null;
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== "string" || body.note.length > MAX_NOTE_LENGTH) problems.add("note", `Text up to ${MAX_NOTE_LENGTH} characters`);
    else note = body.note.trim() === "" ? null : body.note.trim();
  }
  let sessionId: string | null = null;
  if (body.sessionId !== undefined && body.sessionId !== null) {
    if (typeof body.sessionId !== "string" || body.sessionId === "" || body.sessionId.length > 100) problems.add("sessionId", "Required string");
    else sessionId = body.sessionId;
  }
  let from: string | null = null;
  let to: string | null = null;
  if (sessionId === null) {
    if (!isDateString(body.fromDate)) problems.add("fromDate", "Date YYYY-MM-DD (or give a sessionId)");
    else from = body.fromDate;
    if (body.toDate === undefined || body.toDate === null) to = from;
    else if (!isDateString(body.toDate)) problems.add("toDate", "Date YYYY-MM-DD");
    else to = body.toDate;
    if (from && to) {
      if (from < today) problems.add("fromDate", "Declare ahead of time: the date cannot be in the past");
      if (to < from) problems.add("toDate", "Must not be before fromDate");
      else if (daysInRange(from, to) > MAX_RANGE_DAYS) problems.add("toDate", `A declaration spans at most ${MAX_RANGE_DAYS} days`);
    }
  } else if (body.fromDate !== undefined || body.toDate !== undefined) {
    problems.add("sessionId", "Give a sessionId or dates, not both");
  }
  problems.throwIfAny();

  let sessionDate: string | null = null;
  if (sessionId !== null) {
    const session = await db.session.findFirst({ where: { id: sessionId }, select: { id: true, startsAt: true, status: true, batchId: true } });
    if (!session) throw new ApiError("not_found", "Session not found");
    const visible = await db.session.findFirst({ where: { id: sessionId, ...sessionWhere(p) }, select: { id: true } });
    if (!visible) throw new ApiError("forbidden", "This session is outside your own view");
    const enrolled = await db.batchMember.findFirst({ where: { batchId: session.batchId, memberId }, select: { id: true } });
    if (!enrolled) throw new ApiError("forbidden", "This member is not enrolled in this class");
    if (session.status !== "SCHEDULED") throw new ApiError("conflict", "Only an upcoming session can be declared");
    if (session.startsAt.getTime() <= Date.now()) throw new ApiError("conflict", "This session has already started");
    sessionDate = tenantDate(session.startsAt);
  }
  const fromDate = sessionDate ?? from!;
  const toDate = sessionDate ?? to!;

  // Declaring the same thing twice is a conflict, not a second row.
  const live = await db.excusedAbsence.findMany({
    where: { memberId, cancelledAt: null, fromDate: { lte: dateToDb(toDate) }, toDate: { gte: dateToDb(fromDate) } },
    select: { fromDate: true, toDate: true, sessionId: true },
  });
  const duplicate = live.some((d) =>
    sessionId !== null
      ? d.sessionId === sessionId || d.sessionId === null
      : d.sessionId === null && dateFromDb(d.fromDate) <= fromDate && dateFromDb(d.toDate) >= toDate,
  );
  if (duplicate) throw new ApiError("conflict", "This absence is already declared");

  const row = await db.excusedAbsence.create({
    data: {
      tenantId: p.tenantId,
      memberId,
      sessionId,
      fromDate: dateToDb(fromDate),
      toDate: dateToDb(toDate),
      reason: reason!.toUpperCase() as ExcuseReason,
      note,
      createdById: p.userId,
    },
    include,
  });
  return toDto(row);
}

/** POST /excused-absences/{absenceId}/cancel (cancelExcusedAbsence). Withdrawing twice is a safe no-op. */
export async function cancelExcusedAbsence(db: TenantClient, p: Principal, absenceId: string) {
  const row = await db.excusedAbsence.findFirst({ where: { id: absenceId }, include });
  if (!row) throw new ApiError("not_found", "Declared absence not found");
  const visible = await db.excusedAbsence.findFirst({ where: { id: absenceId, member: memberWhere(p) }, select: { id: true } });
  if (!visible) throw new ApiError("forbidden", "This declared absence is outside your own view");
  if (row.cancelledAt) return toDto(row);
  const updated = await db.excusedAbsence.update({ where: { id: absenceId }, data: { cancelledAt: new Date() }, include });
  return toDto(updated);
}
