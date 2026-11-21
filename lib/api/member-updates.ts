import type { MemberUpdateKind, Prisma } from "@prisma/client";

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
