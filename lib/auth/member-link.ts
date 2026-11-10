import { assertCanViewMember } from "./access";
import { ApiError } from "./errors";
import { createMagicLink } from "./magic-link";
import type { Principal } from "./principal";
import type { TenantClient } from "../tenant-scope";

export type MemberMagicLinkDto = {
  url: string;
  expiresAt: string;
  recipient: "member" | "guardian";
};

/**
 * Owner or coach generates a shareable single-use sign-in link for a member (adult) or for
 * the member's parent/guardian (kids). Tenant comes from the caller's session; a member of
 * another tenant is 404, a coach outside their own batches is 403. Delivery is manual.
 */
export async function createMemberMagicLink(
  db: TenantClient,
  principal: Principal,
  memberId: string,
  opts: { now?: Date } = {},
): Promise<MemberMagicLinkDto> {
  await assertCanViewMember(db, principal, memberId);
  const member = await db.member.findFirst({
    where: { id: memberId },
    select: { isMinor: true, userId: true, guardian: { select: { userId: true } } },
  });
  if (!member) throw new ApiError("not_found", "Member not found");
  const guardianUser = member.guardian?.userId ?? null;
  const useGuardian = member.isMinor ? guardianUser !== null : member.userId === null && guardianUser !== null;
  const userId = useGuardian ? guardianUser : member.isMinor ? null : member.userId;
  if (!userId) throw new ApiError("not_found", "This member has no login account to link");
  const link = await createMagicLink(userId, principal.tenantId, { now: opts.now });
  return { url: link.url, expiresAt: link.expiresAt.toISOString(), recipient: useGuardian ? "guardian" : "member" };
}
