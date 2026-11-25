import type { AttendanceStatus, ExcuseReason, Prisma } from "@prisma/client";
import { preMarkClientId } from "../absences/rules";
import { ApiError, type ErrorDetail } from "../auth/errors";
import { publishSummaryTx } from "./class-summary";
import type { Principal } from "../auth/principal";
import type { TenantClient } from "../tenant-scope";
import {
  buildSessionDetail,
  isHoliday,
  loadRoster,
  loadSessionDeclarations,
  loadSessionFor,
  sessionWarnings,
  type Db,
} from "./session-detail";

const STATUSES = ["present", "absent", "excused"] as const;
const REASONS = ["exam", "illness", "festival", "travel"] as const;
const MAX_ENTRIES = 200;
/** Completing a roll call this long before the start is still fine (coaches tap early). */
const EARLY_COMPLETE_MS = 15 * 60_000;
/** Device clocks may run ahead; a markedAt further in the future than this is clamped to now. */
const CLOCK_SKEW_MS = 5 * 60_000;

export type AttendanceEntry = {
  memberId: string;
  status: AttendanceStatus;
  reason: ExcuseReason | null;
  note: string | null;
  clientId: string;
  markedAt: Date | null;
};

/**
 * Timeline rule (CLAUDE.md): a missed class extends the member's timeline, except excused
 * absences and holidays. Only a plain ABSENT on a non-holiday session counts as missed.
 */
export function extendsTimeline(status: AttendanceStatus, sessionIsHoliday: boolean): boolean {
  return status === "ABSENT" && !sessionIsHoliday;
}

export function parseAttendanceBody(body: Record<string, unknown>) {
  const details: ErrorDetail[] = [];
  const bad = (field: string, message: string) => details.push({ field, message });
  const raw = body.entries;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_ENTRIES) {
    throw new ApiError("validation_failed", `entries must hold 1..${MAX_ENTRIES} items`, [
      { field: "entries", message: `Array of 1..${MAX_ENTRIES}` },
    ]);
  }
  const entries: AttendanceEntry[] = [];
  const seenMembers = new Set<string>();
  const seenClients = new Set<string>();
  raw.forEach((e, i) => {
    const f = (k: string) => `entries[${i}].${k}`;
    if (typeof e !== "object" || e === null || Array.isArray(e)) return bad(`entries[${i}]`, "Object required");
    const o = e as Record<string, unknown>;
    const memberId = typeof o.memberId === "string" && o.memberId ? o.memberId : null;
    if (!memberId) bad(f("memberId"), "Required string");
    const status = STATUSES.find((s) => s === o.status);
    if (!status) bad(f("status"), `One of ${STATUSES.join(", ")}`);
    let reason: ExcuseReason | null = null;
    if (o.reason !== undefined && o.reason !== null) {
      const r = REASONS.find((x) => x === o.reason);
      if (!r) bad(f("reason"), `One of ${REASONS.join(", ")}`);
      else reason = r.toUpperCase() as ExcuseReason;
    }
    if (status === "excused" && !reason && (o.reason === undefined || o.reason === null)) bad(f("reason"), "Required when status is excused");
    if (status && status !== "excused" && o.reason !== undefined && o.reason !== null) bad(f("reason"), "Only allowed when status is excused");
    let note: string | null = null;
    if (o.note !== undefined && o.note !== null) {
      if (typeof o.note !== "string" || o.note.length > 280) bad(f("note"), "String up to 280 characters");
      else note = o.note;
    }
    const clientId = typeof o.clientId === "string" && o.clientId.length >= 8 && o.clientId.length <= 64 ? o.clientId : null;
    if (!clientId) bad(f("clientId"), "String of 8..64 characters");
    let markedAt: Date | null = null;
    if (o.markedAt !== undefined && o.markedAt !== null) {
      const d = typeof o.markedAt === "string" && /^\d{4}-\d{2}-\d{2}T/.test(o.markedAt) ? new Date(o.markedAt) : null;
      if (!d || Number.isNaN(d.getTime())) bad(f("markedAt"), "ISO date-time");
      else markedAt = d;
    }
    if (memberId) {
      if (seenMembers.has(memberId)) bad(f("memberId"), "Duplicate member in this request");
      seenMembers.add(memberId);
    }
    if (clientId) {
      if (seenClients.has(clientId)) bad(f("clientId"), "Duplicate clientId in this request");
      seenClients.add(clientId);
    }
    if (memberId && status && clientId) {
      entries.push({ memberId, status: status.toUpperCase() as AttendanceStatus, reason, note, clientId, markedAt });
    }
  });
  let coachNote: string | null | undefined;
  if (body.coachNote !== undefined && body.coachNote !== null) {
    if (typeof body.coachNote !== "string" || body.coachNote.length > 1000) bad("coachNote", "String up to 1000 characters");
    else coachNote = body.coachNote;
  } else if (body.coachNote === null) coachNote = null;
  if (body.complete !== undefined && typeof body.complete !== "boolean") bad("complete", "Boolean");
  let sessionClientId: string | undefined;
  if (body.sessionClientId !== undefined && body.sessionClientId !== null) {
    if (typeof body.sessionClientId !== "string" || body.sessionClientId.length < 1 || body.sessionClientId.length > 64) {
      bad("sessionClientId", "String up to 64 characters");
    } else sessionClientId = body.sessionClientId;
  }
  if (details.length) throw new ApiError("validation_failed", "Invalid attendance request", details);
  return { entries, complete: body.complete === true, coachNote, sessionClientId };
}

/** PUT /sessions/{sessionId}/attendance (recordAttendance). Idempotent and replay-safe. */
export async function recordAttendance(db: TenantClient, p: Principal, sessionId: string, body: Record<string, unknown>) {
  const input = parseAttendanceBody(body);
  const now = new Date();

  await db.$transaction(async (tx: Db) => {
    const s = await loadSessionFor(tx, p, sessionId);
    if (s.status === "CANCELLED") throw new ApiError("conflict", "A cancelled session has no roll call");
    if (input.complete && s.status === "SCHEDULED" && s.startsAt.getTime() - now.getTime() > EARLY_COMPLETE_MS) {
      throw new ApiError("conflict", "This session has not started yet, so it cannot be completed");
    }

    const roster = await loadRoster(tx, s);
    const onRoster = new Map(roster.map((r) => [r.memberId, r]));
    const details: ErrorDetail[] = [];
    input.entries.forEach((e, i) => {
      const r = onRoster.get(e.memberId);
      if (!r) details.push({ field: `entries[${i}].memberId`, message: "Member is not on this session's roster" });
      else if (r.source === "waitlisted") details.push({ field: `entries[${i}].memberId`, message: "Member is only waitlisted" });
    });
    if (details.length) throw new ApiError("validation_failed", "Some members are not on the roster", details);

    const existing = await tx.attendance.findMany({
      where: { OR: [{ sessionId: s.id, memberId: { in: input.entries.map((e) => e.memberId) } }, { clientId: { in: input.entries.map((e) => e.clientId) } }] },
    });
    for (const e of input.entries) {
      const mine = existing.find((x) => x.sessionId === s.id && x.memberId === e.memberId);
      const sameClient = existing.find((x) => x.clientId === e.clientId);
      if (sameClient && sameClient !== mine) {
        throw new ApiError("conflict", "clientId is already used for a different attendance row", [
          { field: "entries.clientId", message: "Reused for another member or session" },
        ]);
      }
      const markedAt = e.markedAt ? new Date(Math.min(e.markedAt.getTime(), now.getTime() + CLOCK_SKEW_MS)) : now;
      const data = { status: e.status, reason: e.reason, note: e.note, clientId: e.clientId, markedAt, markedById: p.userId };
      if (!mine) {
        await tx.attendance.create({ data: { tenantId: p.tenantId, sessionId: s.id, memberId: e.memberId, ...data } });
        continue;
      }
      const same = mine.clientId === e.clientId && mine.status === e.status && mine.reason === e.reason && mine.note === e.note;
      if (same) continue; // exact replay
      if (e.markedAt && markedAt < mine.markedAt) continue; // stale write from a device that was offline longer
      await tx.attendance.update({ where: { id: mine.id }, data });
    }

    // STAR-95: completing the roll call turns every still-unmarked, pre-declared member into a real
    // EXCUSED row (reason from the declaration), so the history shows it and it never counts as missed.
    if (input.complete) {
      const declared = await loadSessionDeclarations(tx, s);
      const marked = new Set((await tx.attendance.findMany({ where: { sessionId: s.id }, select: { memberId: true } })).map((a) => a.memberId));
      for (const r of roster) {
        const dec = declared.get(r.memberId);
        if (!dec || marked.has(r.memberId) || r.source === "waitlisted") continue;
        const clientId = preMarkClientId(dec.id, s.id);
        if (await tx.attendance.findFirst({ where: { clientId }, select: { id: true } })) continue;
        await tx.attendance.create({
          data: { tenantId: p.tenantId, sessionId: s.id, memberId: r.memberId, status: "EXCUSED", reason: dec.reason.toUpperCase() as ExcuseReason, clientId, markedAt: now, markedById: p.userId },
        });
      }
    }

    // A class workout is attached: finishing the roll call publishes the after-class summary and tells every
    // marked member (present: what they did; absent: a catch-up; excused: the same, in softer words).
    if (input.complete && s.status === "SCHEDULED" && s.planDayId) {
      await publishSummaryTx(tx, p, s, { coachNote: input.coachNote !== undefined ? input.coachNote : s.coachNote }, now);
    }

    const sessionData: Prisma.SessionUncheckedUpdateInput = {};
    if (input.coachNote !== undefined) sessionData.coachNote = input.coachNote;
    if (input.complete && s.status === "SCHEDULED") {
      sessionData.status = "COMPLETED";
      sessionData.completedAt = now;
    }
    if (input.sessionClientId && !s.clientId) {
      const taken = await tx.session.findFirst({ where: { clientId: input.sessionClientId }, select: { id: true } });
      if (!taken) sessionData.clientId = input.sessionClientId;
    }
    if (Object.keys(sessionData).length) await tx.session.update({ where: { id: s.id }, data: sessionData });
  });

  return db.$transaction(async (tx: Db) => {
    const row = await loadSessionFor(tx, p, sessionId);
    const warnings = (await isHoliday(tx, row.startsAt))
      ? (await sessionWarnings(tx, row)).filter((w) => w.code === "on_holiday")
      : [];
    return buildSessionDetail(tx, p, row, warnings);
  });
}
