import type { MemberUpdateKind, Prisma } from "@prisma/client";
import { assertCanViewMember } from "../auth/access";
import { ApiError } from "../auth/errors";
import type { Principal } from "../auth/principal";
import type { TenantClient } from "../tenant-scope";
import { pageArgs, toPage } from "./pagination";

export type MemberUpdateEntity = "plan" | "assignment" | "goal" | "session" | "booking";

/** Minimal client surface so both a scoped client and a transaction client work. */
type UpdateWriter = {
  memberUpdate: { createMany: (args: { data: Prisma.MemberUpdateCreateManyInput[] }) => Promise<unknown> };
};

export type RecordMemberUpdatesInput = {
  memberIds: string[];
  kind: MemberUpdateKind;
  entityType: MemberUpdateEntity;
  entityId: string;
  actorId?: string | null;
  /** i18n params: plain strings only (plan title, session date/time); never another member's name. */
  params?: Record<string, string>;
};

/**
 * Inserts one `member_updates` row per member. Call inside the caller's transaction using a
 * tenant-scoped client (`forTenant`), which injects `tenantId`. Duplicate member ids are collapsed.
 */
export async function recordMemberUpdates(
  tx: UpdateWriter,
  input: RecordMemberUpdatesInput,
  tenantId?: string,
): Promise<number> {
  const memberIds = [...new Set(input.memberIds)];
  if (memberIds.length === 0) return 0;
  await tx.memberUpdate.createMany({
    data: memberIds.map((memberId) => ({
      ...(tenantId ? { tenantId } : ({} as { tenantId: string })),
      memberId,
      actorId: input.actorId ?? null,
      kind: input.kind,
      entityType: input.entityType,
      entityId: input.entityId,
      params: input.params ?? {},
    })),
  });
  return memberIds.length;
}

// ---- Reader (STAR-65) ----

/** Short English fallback; the UI renders from kind + params through i18n. */
export function updateTitle(kind: MemberUpdateKind, params: Record<string, string>): string {
  const plan = params.planTitle ?? "your plan";
  const goal = params.goalTitle ?? "your goal";
  const when = [params.date, params.time].filter(Boolean).join(" ");
  switch (kind) {
    case "PLAN_ASSIGNED":
      return `New workout plan: ${plan}`;
    case "PLAN_UPDATED":
      return `Your plan ${plan} was updated`;
    case "PLAN_ENDED":
      return `Your plan ${plan} has ended`;
    case "GOAL_SET":
      return `New goal: ${goal}`;
    case "GOAL_UPDATED":
      return `Your goal ${goal} was updated`;
    case "SESSION_SCHEDULED":
      return when ? `Session scheduled for ${when}` : "A session was scheduled";
    case "SESSION_RESCHEDULED":
      return when ? `Session moved to ${when}` : "A session was moved";
    case "SESSION_CANCELLED":
      return when ? `Session on ${when} was cancelled` : "A session was cancelled";
    case "BOOKING_CONFIRMED":
      return when ? `Booking confirmed for ${when}` : "Your booking is confirmed";
    case "WAITLIST_PROMOTED":
      return when ? `You are in: spot confirmed for ${when}` : "A spot opened up and you are booked in";
  }
}

function stringParams(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw)) if (typeof v === "string" || typeof v === "number") out[k] = String(v);
  }
  return out;
}

/** GET /members/{memberId}/updates (listMemberUpdates): newest first, with the unread count. */
export async function listMemberUpdates(db: TenantClient, p: Principal, memberId: string, params: URLSearchParams) {
  await assertCanViewMember(db, p, memberId);
  const { limit, args } = pageArgs(params);
  const [rows, unreadCount] = await Promise.all([
    db.memberUpdate.findMany({
      where: { memberId },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      include: { actor: { select: { name: true } } },
      ...args,
    }),
    db.memberUpdate.count({ where: { memberId, readAt: null } }),
  ]);
  const page = toPage(rows, limit);
  return {
    items: page.rows.map((r) => {
      const prm = stringParams(r.params);
      return {
        id: r.id,
        memberId: r.memberId,
        kind: r.kind.toLowerCase(),
        entityType: r.entityType,
        entityId: r.entityId,
        actorName: r.actor?.name ?? null,
        title: updateTitle(r.kind, prm),
        params: prm,
        createdAt: r.createdAt.toISOString(),
        read: r.readAt !== null,
      };
    }),
    unreadCount,
    nextCursor: page.nextCursor,
  };
}

/** POST /members/{memberId}/updates/read (markMemberUpdatesRead): marks updates created up to `upTo` as read. */
export async function markMemberUpdatesRead(db: TenantClient, p: Principal, memberId: string, body: unknown, now = new Date()) {
  await assertCanViewMember(db, p, memberId);
  const raw = typeof body === "object" && body !== null ? (body as Record<string, unknown>).upTo : undefined;
  const upTo = typeof raw === "string" && /^\d{4}-\d{2}-\d{2}T/.test(raw) ? new Date(raw) : null;
  if (!upTo || Number.isNaN(upTo.getTime())) {
    throw new ApiError("validation_failed", "upTo must be an ISO date-time", [{ field: "upTo", message: "ISO date-time" }]);
  }
  await db.memberUpdate.updateMany({ where: { memberId, readAt: null, createdAt: { lte: upTo } }, data: { readAt: now } });
}
