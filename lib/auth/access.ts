import type { Prisma } from "@prisma/client";
import { ApiError } from "./errors";
import type { Principal } from "./principal";
import type { TenantClient } from "../tenant-scope";

/**
 * Row-level visibility per role (the "own view" rules in docs/api/openapi.yaml):
 *  - owner: the whole tenant
 *  - coach: only their own batches, the members in them and their sessions
 *  - customer: only themselves or the children they are the guardian of
 * These return Prisma `where` fragments. They are always used with a client from
 * forTenant(), which adds the tenant filter on top.
 */
export function memberWhere(p: Principal): Prisma.MemberWhereInput {
  switch (p.role) {
    case "owner":
      return {};
    case "coach":
      return { enrollments: { some: { batch: { coachId: p.userId } } } };
    case "customer":
      return { OR: [{ userId: p.userId }, { guardian: { userId: p.userId } }] };
  }
}

export function batchWhere(p: Principal): Prisma.BatchWhereInput {
  switch (p.role) {
    case "owner":
      return {};
    case "coach":
      return { coachId: p.userId };
    case "customer":
      return { enrollments: { some: { member: memberWhere(p) } } };
  }
}

export function sessionWhere(p: Principal): Prisma.SessionWhereInput {
  switch (p.role) {
    case "owner":
      return {};
    case "coach":
      return { coachId: p.userId };
    case "customer":
      return { batch: batchWhere(p) };
  }
}

/**
 * 404 when the row is not in the caller's tenant (or does not exist), 403 when it is in
 * the tenant but outside the caller's own view.
 */
export async function assertCanViewMember(db: TenantClient, p: Principal, memberId: string): Promise<void> {
  const inTenant = await db.member.findFirst({ where: { id: memberId }, select: { id: true } });
  if (!inTenant) throw new ApiError("not_found", "Member not found");
  const visible = await db.member.findFirst({ where: { id: memberId, ...memberWhere(p) }, select: { id: true } });
  if (!visible) throw new ApiError("forbidden", "This member is outside your own view");
}

export async function assertCanViewBatch(db: TenantClient, p: Principal, batchId: string): Promise<void> {
  const inTenant = await db.batch.findFirst({ where: { id: batchId }, select: { id: true } });
  if (!inTenant) throw new ApiError("not_found", "Batch not found");
  const visible = await db.batch.findFirst({ where: { id: batchId, ...batchWhere(p) }, select: { id: true } });
  if (!visible) throw new ApiError("forbidden", "This batch is outside your own view");
}
