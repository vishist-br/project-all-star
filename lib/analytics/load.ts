/** Grouped database reads shared by the analytics and coach endpoints (one query per kind, never per row). */
import type { Prisma } from "@prisma/client";
import { addDays, startOfDay } from "../api/schedule";
import { tenantDate } from "../api/pagination";
import type { TenantClient } from "../tenant-scope";
import { dateFromDb } from "../workouts/validate";
import type { AttMap, AttTally, MemberLife, SessionFact } from "./formulas";

export type MemberRow = MemberLife & { id: string; displayName: string };

export async function loadMembers(db: TenantClient): Promise<MemberRow[]> {
  const rows = await db.member.findMany({ select: { id: true, displayName: true, joinedOn: true, leftOn: true, isActive: true } });
  return rows.map((m) => ({
    id: m.id,
    displayName: m.displayName,
    joinedOn: dateFromDb(m.joinedOn),
    leftOn: m.leftOn ? dateFromDb(m.leftOn) : null,
    isActive: m.isActive,
  }));
}

/** Sessions with start in [from, to] (tenant dates), optionally for some coaches only. */
export async function loadSessions(db: TenantClient, from: string, to: string, coachIds?: string[]): Promise<SessionFact[]> {
  const rows = await db.session.findMany({
    where: { startsAt: { gte: startOfDay(from), lt: startOfDay(addDays(to, 1)) }, ...(coachIds ? { coachId: { in: coachIds } } : {}) },
    select: { id: true, startsAt: true, endsAt: true, status: true, coachId: true, batchId: true, capacity: true },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
  });
  return rows.map((s) => ({ ...s, date: tenantDate(s.startsAt) }));
}

/** Attendance counts per COMPLETED session in [from, to]: one grouped query. */
export async function loadAttendanceMap(db: TenantClient, from: string, to: string, coachIds?: string[]): Promise<AttMap> {
  const session: Prisma.SessionWhereInput = {
    status: "COMPLETED",
    startsAt: { gte: startOfDay(from), lt: startOfDay(addDays(to, 1)) },
    ...(coachIds ? { coachId: { in: coachIds } } : {}),
  };
  const groups = await db.attendance.groupBy({ by: ["sessionId", "status"], where: { session }, _count: { _all: true } });
  const out = new Map<string, AttTally>();
  for (const g of groups) {
    const t = out.get(g.sessionId) ?? { present: 0, absent: 0, excused: 0 };
    if (g.status === "PRESENT") t.present += g._count._all;
    else if (g.status === "ABSENT") t.absent += g._count._all;
    else t.excused += g._count._all;
    out.set(g.sessionId, t);
  }
  return out;
}
