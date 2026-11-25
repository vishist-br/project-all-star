import type { AttendanceStatus, MemberUpdateKind, PrismaClient } from "@prisma/client";
import { assertCanViewMember, planViewWhere } from "../auth/access";
import { ApiError } from "../auth/errors";
import type { Principal } from "../auth/principal";
import { hashToken, newToken } from "../auth/tokens";
import { prisma as defaultPrisma } from "../db";
import { forTenant, type TenantClient } from "../tenant-scope";
import { expandPlanDay, type Block } from "../workouts/supersets";
import { Problems, isRecord } from "../workouts/validate";
import { recordMemberUpdates } from "./member-updates";
import { pageArgs, tenantDate, toPage } from "./pagination";
import { loadSessionFor, sessionInclude, type Db, type SessionRow } from "./session-detail";

export const SHARE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// ---- class workout snapshot ----

export type ClassWorkoutItem = {
  id: string;
  exerciseId: string;
  exerciseName: string;
  metricType: string;
  position: number;
  sets: number | null;
  reps: number | null;
  durationSeconds: number | null;
  restSeconds: number | null;
  supersetGroup: string | null;
  rounds: number | null;
  targetWeightKg: number | null;
  targetDistanceMeters: number | null;
  notes: string | null;
};
export type ClassWorkout = { planId: string; planTitle: string; dayTitle: string | null; blocks: Block<ClassWorkoutItem>[] };

/** The plan day as a render-ready workout (live items only). Null when the day is gone. */
export async function buildClassWorkout(db: Db | TenantClient, planDayId: string): Promise<ClassWorkout | null> {
  const day = await db.workoutPlanDay.findFirst({
    where: { id: planDayId },
    include: {
      plan: { select: { id: true, title: true } },
      items: { where: { archivedAt: null }, orderBy: [{ position: "asc" }, { id: "asc" }], include: { exercise: { select: { name: true, metricType: true } } } },
    },
  });
  if (!day) return null;
  const items: ClassWorkoutItem[] = day.items.map((i) => ({
    id: i.id,
    exerciseId: i.exerciseId,
    exerciseName: i.exercise.name,
    metricType: i.exercise.metricType,
    position: i.position,
    sets: i.sets,
    reps: i.reps,
    durationSeconds: i.durationSeconds,
    restSeconds: i.restSeconds,
    supersetGroup: i.supersetGroup,
    rounds: i.rounds,
    targetWeightKg: i.targetWeightKg === null ? null : Number(i.targetWeightKg.toString()),
    targetDistanceMeters: i.targetDistanceMeters,
    notes: i.notes,
  }));
  return { planId: day.plan.id, planTitle: day.plan.title, dayTitle: day.title, blocks: expandPlanDay(items) };
}

const firstName = (displayName: string) => displayName.trim().split(/\s+/)[0] ?? displayName;

// ---- attach / read the class workout ----

/** PUT /sessions/{sessionId}/workout (attachSessionWorkout). `planDayId: null` detaches. */
export async function attachSessionWorkout(db: TenantClient, p: Principal, sessionId: string, body: unknown) {
  if (!isRecord(body) || !("planDayId" in body)) {
    throw new ApiError("validation_failed", "planDayId is required (a plan day id, or null to detach)", [{ field: "planDayId", message: "String or null" }]);
  }
  const planDayId = body.planDayId;
  if (planDayId !== null && (typeof planDayId !== "string" || planDayId.length === 0)) {
    throw new ApiError("validation_failed", "planDayId must be a plan day id or null", [{ field: "planDayId", message: "String or null" }]);
  }
  const s = await loadSessionFor(db, p, sessionId);
  if (s.status === "CANCELLED") throw new ApiError("conflict", "A cancelled session cannot carry a workout");
  if (planDayId !== null) {
    const inTenant = await db.workoutPlanDay.findFirst({ where: { id: planDayId }, select: { id: true, plan: { select: { status: true } }, items: { where: { archivedAt: null }, select: { id: true }, take: 1 } } });
    if (!inTenant) throw new ApiError("not_found", "Plan day not found");
    const visible = await db.workoutPlanDay.findFirst({ where: { id: planDayId, plan: planViewWhere(p) }, select: { id: true } });
    if (!visible) throw new ApiError("forbidden", "This plan is outside your own view");
    if (inTenant.plan.status === "ARCHIVED") throw new ApiError("conflict", "An archived plan cannot be used as a class workout");
    if (inTenant.items.length === 0) throw new ApiError("validation_failed", "This plan day has no exercises", [{ field: "planDayId", message: "Day has no items" }]);
  }
  await db.session.update({ where: { id: s.id }, data: { planDayId } });
  return { sessionId: s.id, planDayId, workout: planDayId ? await buildClassWorkout(db, planDayId) : null };
}

/** GET /sessions/{sessionId}/workout (getSessionWorkout): the class workout, same visibility as getSession. */
export async function getSessionWorkout(db: TenantClient, p: Principal, sessionId: string) {
  const s = await loadSessionFor(db, p, sessionId);
  return { sessionId: s.id, planDayId: s.planDayId, workout: s.planDayId ? await buildClassWorkout(db, s.planDayId) : null };
}

// ---- publishing ----

const UPDATE_KIND: Record<AttendanceStatus, MemberUpdateKind> = {
  PRESENT: "CLASS_SUMMARY",
  ABSENT: "CLASS_CATCHUP",
  EXCUSED: "CLASS_CATCHUP_EXCUSED",
};

export type SummaryContent = { coachNote?: string | null; homePractice?: string | null };

/**
 * Creates or updates the summary of a session and writes one member update per marked member who has
 * not been told yet (present: summary, absent: catch-up, excused: softer catch-up). The update params
 * carry only the class name and date, never another member's name. Runs inside the caller's transaction.
 */
export async function publishSummaryTx(tx: Db, p: Principal, s: SessionRow, content: SummaryContent, now = new Date()) {
  const workout = s.planDayId ? await buildClassWorkout(tx, s.planDayId) : null;
  const existing = await tx.classSummary.findFirst({ where: { sessionId: s.id } });
  const data = {
    ...(content.coachNote !== undefined ? { coachNote: content.coachNote } : existing ? {} : { coachNote: s.coachNote }),
    ...(content.homePractice !== undefined ? { homePractice: content.homePractice } : {}),
    workoutSnapshot: (workout ?? null) as never,
    publishedById: p.userId,
  };
  const summary = existing
    ? await tx.classSummary.update({ where: { id: existing.id }, data })
    : await tx.classSummary.create({ data: { ...data, sessionId: s.id, publishedAt: now } as never });

  const marked = await tx.attendance.findMany({ where: { sessionId: s.id }, select: { memberId: true, status: true } });
  const told = new Set(
    (await tx.memberUpdate.findMany({ where: { entityType: "class_summary", entityId: s.id, memberId: { in: marked.map((m) => m.memberId) } }, select: { memberId: true } })).map((u) => u.memberId),
  );
  const params = { batchName: s.batch.name, date: tenantDate(s.startsAt) };
  let notified = 0;
  for (const status of ["PRESENT", "ABSENT", "EXCUSED"] as const) {
    const ids = marked.filter((m) => m.status === status && !told.has(m.memberId)).map((m) => m.memberId);
    notified += await recordMemberUpdates(tx, { memberIds: ids, kind: UPDATE_KIND[status], entityType: "class_summary", entityId: s.id, actorId: p.userId, params });
  }
  return { summaryId: summary.id, notified };
}

function parseContent(body: unknown): SummaryContent {
  if (!isRecord(body)) throw new ApiError("validation_failed", "Body must be a JSON object");
  const v = new Problems();
  const out: SummaryContent = {};
  for (const k of ["coachNote", "homePractice"] as const) {
    const x = body[k];
    if (x === undefined) continue;
    if (x === null) out[k] = null;
    else if (typeof x === "string" && x.length <= 1000) out[k] = x.trim() === "" ? null : x;
    else v.add(k, "Text up to 1000 characters or null");
  }
  v.throwIfAny();
  return out;
}

/** POST /sessions/{sessionId}/summary (publishClassSummary). Safe to repeat: members are told once. */
export async function publishClassSummary(db: TenantClient, p: Principal, sessionId: string, body: unknown, now = new Date()) {
  const content = parseContent(body);
  await db.$transaction(async (tx) => {
    const s = await loadSessionFor(tx, p, sessionId);
    if (s.status === "CANCELLED") throw new ApiError("conflict", "A cancelled session has no summary");
    if (s.status !== "COMPLETED" && s.startsAt.getTime() > now.getTime()) throw new ApiError("conflict", "The class has not happened yet");
    await publishSummaryTx(tx, p, s, content, now);
  });
  return loadSummaryDto(db, p, sessionId, null);
}

// ---- reading ----

type StatusDto = "present" | "absent" | "excused";
const statusDto = (s: AttendanceStatus): StatusDto => s.toLowerCase() as StatusDto;

/** Message keys and params a screen translates for a member's own view. Only the member's first name. */
export function memberView(status: StatusDto, name: string, batchName: string, date: string) {
  return {
    status,
    titleKey: `cs.${status}.title`,
    bodyKey: `cs.${status}.body`,
    params: { firstName: firstName(name), batchName, date },
  };
}

type SummaryRow = {
  id: string;
  coachNote: string | null;
  homePractice: string | null;
  workoutSnapshot: unknown;
  publishedAt: Date;
};
type SessionLite = { id: string; startsAt: Date; endsAt: Date; batch: { name: string } };

function summaryDto(
  r: SummaryRow,
  s: SessionLite,
  extra: { counts: { present: number; absent: number; excused: number } | null; forMember: ReturnType<typeof memberView> & { memberId: string } | null },
) {
  return {
    id: r.id,
    sessionId: s.id,
    batchName: s.batch.name,
    startsAt: s.startsAt.toISOString(),
    endsAt: s.endsAt.toISOString(),
    coachNote: r.coachNote,
    homePractice: r.homePractice,
    publishedAt: r.publishedAt.toISOString(),
    workout: (r.workoutSnapshot ?? null) as ClassWorkout | null,
    counts: extra.counts,
    forMember: extra.forMember,
  };
}

async function attendanceCounts(db: TenantClient, sessionId: string) {
  const groups = await db.attendance.groupBy({ by: ["status"], where: { sessionId }, _count: { _all: true } });
  const c = { present: 0, absent: 0, excused: 0 };
  for (const g of groups) c[statusDto(g.status)] += g._count._all;
  return c;
}

async function loadSummaryDto(db: TenantClient, p: Principal, sessionId: string, memberId: string | null) {
  const s = await loadSessionFor(db, p, sessionId);
  const row = await db.classSummary.findFirst({ where: { sessionId: s.id } });
  if (!row) throw new ApiError("not_found", "No summary has been published for this class");
  let forMember: Parameters<typeof summaryDto>[2]["forMember"] = null;
  if (memberId) {
    await assertCanViewMember(db, p, memberId);
    const att = await db.attendance.findFirst({ where: { sessionId: s.id, memberId }, select: { status: true, member: { select: { displayName: true } } } });
    if (!att) throw new ApiError("not_found", "This member was not marked in this class");
    forMember = { memberId, ...memberView(statusDto(att.status), att.member.displayName, s.batch.name, tenantDate(s.startsAt)) };
  }
  return summaryDto(row, s, { counts: p.role === "customer" ? null : await attendanceCounts(db, s.id), forMember });
}

/**
 * GET /sessions/{sessionId}/summary?memberId= (getClassSummary). Customers must name one of their own
 * members (400 otherwise). Owner and coach may omit it and then also get the attendance counts.
 */
export async function getClassSummary(db: TenantClient, p: Principal, sessionId: string, params: URLSearchParams) {
  const memberId = params.get("memberId") || null;
  if (p.role === "customer" && !memberId) {
    throw new ApiError("validation_failed", "memberId is required", [{ field: "memberId", message: "Name the member (yourself or your child)" }]);
  }
  return loadSummaryDto(db, p, sessionId, memberId);
}

/** GET /members/{memberId}/class-summaries (getMemberClassSummaries): newest class first. */
export async function getMemberClassSummaries(db: TenantClient, p: Principal, memberId: string, params: URLSearchParams) {
  await assertCanViewMember(db, p, memberId);
  const { limit, args } = pageArgs(params);
  const member = await db.member.findFirst({ where: { id: memberId }, select: { displayName: true } });
  const rows = await db.classSummary.findMany({
    where: { session: { attendance: { some: { memberId } } } },
    orderBy: [{ session: { startsAt: "desc" } }, { id: "asc" }],
    include: { session: { select: { id: true, startsAt: true, endsAt: true, batch: { select: { name: true } } } } },
    ...args,
  });
  const page = toPage(rows, limit);
  const att = await db.attendance.findMany({ where: { memberId, sessionId: { in: page.rows.map((r) => r.sessionId) } }, select: { sessionId: true, status: true } });
  const statusBy = new Map(att.map((a) => [a.sessionId, a.status]));
  return {
    items: page.rows.map((r) =>
      summaryDto(r, r.session, {
        counts: null,
        forMember: { memberId, ...memberView(statusDto(statusBy.get(r.sessionId) ?? "ABSENT"), member?.displayName ?? "", r.session.batch.name, tenantDate(r.session.startsAt)) },
      }),
    ),
    nextCursor: page.nextCursor,
  };
}

// ---- share link ----

/** POST /sessions/{sessionId}/summary/shares (createClassSummaryShare): a 30-day link for one member's view. */
export async function createClassSummaryShare(db: TenantClient, p: Principal, sessionId: string, body: unknown, now = new Date()) {
  if (!isRecord(body) || typeof body.memberId !== "string" || body.memberId.length === 0) {
    throw new ApiError("validation_failed", "memberId is required", [{ field: "memberId", message: "Required string" }]);
  }
  const memberId = body.memberId;
  const s = await loadSessionFor(db, p, sessionId);
  const summary = await db.classSummary.findFirst({ where: { sessionId: s.id }, select: { id: true } });
  if (!summary) throw new ApiError("not_found", "No summary has been published for this class");
  await assertCanViewMember(db, p, memberId);
  const att = await db.attendance.findFirst({ where: { sessionId: s.id, memberId }, select: { id: true } });
  if (!att) throw new ApiError("not_found", "This member was not marked in this class");
  const token = newToken();
  const expiresAt = new Date(now.getTime() + SHARE_TTL_MS);
  await db.classSummaryShare.create({ data: { summaryId: summary.id, memberId, tokenHash: hashToken(token), expiresAt, createdById: p.userId } as never });
  const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
  return { url: `${base}/share/class/${token}`, expiresAt: expiresAt.toISOString() };
}

/**
 * GET /public/class-summaries/{token} (getSharedClassSummary). No sign-in. The token is looked up by its
 * hash; unknown, revoked and expired links are all the same 404. Shows the member's first name only, never
 * a member or session id. The route sets `X-Robots-Tag: noindex, nofollow` and `Cache-Control: no-store`.
 */
export async function getSharedClassSummary(token: string, opts: { client?: PrismaClient; now?: Date } = {}) {
  const client = opts.client ?? defaultPrisma;
  const now = opts.now ?? new Date();
  const gone = () => new ApiError("not_found", "This link is invalid or has expired");
  if (typeof token !== "string" || token.length === 0 || token.length > 200) throw gone();
  // The tenant is unknown until the token is found, so this one lookup uses the base client.
  const share = await client.classSummaryShare.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!share || share.revokedAt || share.expiresAt <= now) throw gone();
  const db = forTenant(client, share.tenantId);
  const [summary, member, tenant] = await Promise.all([
    db.classSummary.findFirst({ where: { id: share.summaryId }, include: { session: { include: sessionInclude } } }),
    db.member.findFirst({ where: { id: share.memberId }, select: { displayName: true } }),
    client.tenant.findUnique({ where: { id: share.tenantId }, select: { name: true, slug: true } }),
  ]);
  if (!summary || !member || !tenant) throw gone();
  const att = await db.attendance.findFirst({ where: { sessionId: summary.sessionId, memberId: share.memberId }, select: { status: true } });
  if (!att) throw gone();
  const view = memberView(statusDto(att.status), member.displayName, summary.session.batch.name, tenantDate(summary.session.startsAt));
  return {
    tenantName: tenant.name,
    tenantSlug: tenant.slug,
    firstName: firstName(member.displayName),
    batchName: summary.session.batch.name,
    startsAt: summary.session.startsAt.toISOString(),
    endsAt: summary.session.endsAt.toISOString(),
    ...view,
    coachNote: summary.coachNote,
    homePractice: summary.homePractice,
    workout: (summary.workoutSnapshot ?? null) as ClassWorkout | null,
    expiresAt: share.expiresAt.toISOString(),
  };
}
