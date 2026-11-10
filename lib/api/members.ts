import type { Prisma } from "@prisma/client";
import { assertCanViewMember, memberWhere } from "../auth/access";
import { ApiError } from "../auth/errors";
import type { Principal } from "../auth/principal";
import type { TenantClient } from "../tenant-scope";
import { enumParam, pageArgs, tenantDate, toPage } from "./pagination";

type FeeStatusDto = "paid" | "due" | "overdue";

export type MemberSummaryDto = {
  id: string;
  name: string;
  status: "active" | "paused" | "ended";
  batchIds: string[];
  sportId: string | null;
  level: string | null;
  feeStatus?: FeeStatusDto;
  attendancePercent: number | null;
};

export type MemberDetailDto = MemberSummaryDto & {
  phone: string | null;
  guardianName: string | null;
  joinDate: string;
  goal: string | null;
  progressPercent: number;
  attendance: { attended: number; missed: number; excused: number; scheduled: number };
  recentSessions: {
    sessionId: string;
    date: string;
    attendance: "present" | "absent" | "excused" | "not_marked";
    excusedReason: "exam" | "illness" | "festival" | "travel" | null;
  }[];
};

const MEMBER_STATUSES = ["active", "paused", "ended"] as const;

const summaryInclude = {
  enrollments: {
    where: { leftOn: null },
    select: { batchId: true, batch: { select: { sportId: true } } },
    orderBy: { createdAt: "asc" },
  },
  levelHistory: {
    select: { level: { select: { name: true, rank: true } } },
    orderBy: [{ achievedOn: "desc" }, { level: { rank: "desc" } }],
    take: 1,
  },
} satisfies Prisma.MemberInclude;

type SummaryRow = Prisma.MemberGetPayload<{ include: typeof summaryInclude }>;

/** WAIVED has no value in the contract's FeeStatus enum, so it is omitted (see task comment). */
function feeStatus(s: string): FeeStatusDto | undefined {
  return s === "PAID" ? "paid" : s === "DUE" ? "due" : s === "OVERDUE" ? "overdue" : undefined;
}

/** Percent of marked sessions attended. Excused sessions are left out of the denominator. */
function percent(attended: number, missed: number): number | null {
  const total = attended + missed;
  return total === 0 ? null : Math.round((attended / total) * 1000) / 10;
}

async function attendanceCounts(db: TenantClient, memberIds: string[]) {
  const out = new Map<string, { attended: number; missed: number; excused: number }>();
  if (memberIds.length === 0) return out;
  const grouped = await db.attendance.groupBy({
    by: ["memberId", "status"],
    where: { memberId: { in: memberIds } },
    _count: { _all: true },
  });
  for (const g of grouped) {
    const c = out.get(g.memberId) ?? { attended: 0, missed: 0, excused: 0 };
    if (g.status === "PRESENT") c.attended += g._count._all;
    else if (g.status === "ABSENT") c.missed += g._count._all;
    else c.excused += g._count._all;
    out.set(g.memberId, c);
  }
  return out;
}

function summarize(m: SummaryRow, counts: { attended: number; missed: number } | undefined): MemberSummaryDto {
  const fee = feeStatus(m.feeStatus);
  return {
    id: m.id,
    name: m.displayName,
    status: m.isActive ? "active" : "ended",
    batchIds: m.enrollments.map((e) => e.batchId),
    sportId: m.enrollments[0]?.batch.sportId ?? null,
    level: m.levelHistory[0]?.level.name ?? null,
    ...(fee ? { feeStatus: fee } : {}),
    attendancePercent: counts ? percent(counts.attended, counts.missed) : null,
  };
}

/** GET /members (listMembers). Owner: all. Coach: members of own batches. */
export async function listMembers(db: TenantClient, p: Principal, params: URLSearchParams) {
  const { limit, args } = pageArgs(params);
  const and: Prisma.MemberWhereInput[] = [memberWhere(p)];
  const q = params.get("q")?.trim();
  if (q) and.push({ OR: [{ displayName: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }] });
  const batchId = params.get("batchId");
  if (batchId) and.push({ enrollments: { some: { batchId, leftOn: null } } });
  const status = enumParam(params, "status", MEMBER_STATUSES);
  // The schema has no "paused" state yet, so that filter matches nothing (see task comment).
  if (status === "active") and.push({ isActive: true });
  else if (status === "ended") and.push({ isActive: false });
  else if (status === "paused") and.push({ id: { in: [] } });

  const rows = await db.member.findMany({
    where: { AND: and },
    orderBy: [{ displayName: "asc" }, { id: "asc" }],
    include: summaryInclude,
    ...args,
  });
  const page = toPage(rows, limit);
  const counts = await attendanceCounts(db, page.rows.map((m) => m.id));
  return { items: page.rows.map((m) => summarize(m, counts.get(m.id))), nextCursor: page.nextCursor };
}

/**
 * GET /members/{memberId} (getMember). 404 for another tenant's id, 403 when the member is
 * outside the caller's own view.
 */
export async function getMember(db: TenantClient, p: Principal, memberId: string): Promise<MemberDetailDto> {
  await assertCanViewMember(db, p, memberId);
  const m = await db.member.findFirst({
    where: { id: memberId },
    include: {
      ...summaryInclude,
      guardian: { select: { name: true, phone: true } },
      goals: { where: { status: "ACTIVE" }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!m) throw new ApiError("not_found", "Member not found");

  const counts = (await attendanceCounts(db, [m.id])).get(m.id) ?? { attended: 0, missed: 0, excused: 0 };
  const batchIds = m.enrollments.map((e) => e.batchId);
  const joined = m.joinedOn;
  const scheduled = batchIds.length
    ? await db.session.count({
        where: { batchId: { in: batchIds }, status: { not: "CANCELLED" }, startsAt: { gte: joined } },
      })
    : 0;

  const recent = await db.attendance.findMany({
    where: { memberId: m.id },
    orderBy: [{ session: { startsAt: "desc" } }, { id: "asc" }],
    take: 10,
    select: { sessionId: true, status: true, reason: true, session: { select: { startsAt: true } } },
  });

  // Progress: against the active goal's session target when it has one, otherwise how far
  // up the sport's level ladder the member is. The missed-class timeline rule is a later task.
  const goal = m.goals[0] ?? null;
  let progress = 0;
  if (goal?.targetSessions) {
    progress = Math.min(100, (counts.attended / goal.targetSessions) * 100);
  } else if (m.levelHistory[0] && m.enrollments[0]) {
    const top = await db.level.aggregate({
      where: { sportId: m.enrollments[0].batch.sportId },
      _max: { rank: true },
    });
    const max = top._max.rank ?? 0;
    if (max > 0) progress = Math.min(100, (m.levelHistory[0].level.rank / max) * 100);
  }

  return {
    ...summarize(m, counts),
    phone: m.phone ?? m.guardian?.phone ?? null,
    guardianName: m.guardian?.name ?? null,
    joinDate: joined.toISOString().slice(0, 10),
    goal: goal?.title ?? null,
    progressPercent: Math.round(progress * 10) / 10,
    attendance: { ...counts, scheduled },
    recentSessions: recent.map((a) => ({
      sessionId: a.sessionId,
      date: tenantDate(a.session.startsAt),
      attendance: a.status.toLowerCase() as "present" | "absent" | "excused",
      excusedReason: a.reason ? (a.reason.toLowerCase() as "exam" | "illness" | "festival" | "travel") : null,
    })),
  };
}
