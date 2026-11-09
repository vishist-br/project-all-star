import type { PrismaClient } from "@prisma/client";
import { prisma } from "../db";
import { forTenant, type TenantClient } from "../tenant-scope";
import { ApiError, errorResponse } from "./errors";
import { OPERATION_ROLES, type OperationId } from "./policy";
import type { Principal } from "./principal";
import { resolvePrincipal } from "./session";

export type AuthContext = { principal: Principal; db: TenantClient };

/**
 * Pure role check. `null` means unauthenticated (401). A role outside the operation's
 * `x-roles` is rejected (403). Public operations accept anyone.
 */
export function checkRole(principal: Principal | null, operation: OperationId): Principal | null {
  const rule = OPERATION_ROLES[operation] as readonly string[] | "public";
  if (rule === "public") return principal;
  if (!principal) throw new ApiError("unauthorized", "Missing, expired or invalid credentials");
  if (!rule.includes(principal.role)) throw new ApiError("forbidden", "Your role cannot perform this action");
  return principal;
}

/** Authorize an already-resolved principal and attach a tenant-scoped client. */
export function authorizeWith(
  principal: Principal | null,
  operation: OperationId,
  client: PrismaClient = prisma,
): AuthContext {
  const p = checkRole(principal, operation);
  if (!p) throw new ApiError("unauthorized", "Missing, expired or invalid credentials");
  return { principal: p, db: forTenant(client, p.tenantId) };
}

/** Resolve the bearer token on the request, then enforce the role for the operation. */
export async function authorize(request: Request, operation: OperationId): Promise<AuthContext> {
  return authorizeWith(await resolvePrincipal(request), operation);
}

/** Route wrapper: authorizes, runs the handler, maps ApiError to the contract's error shape. */
export function withAuth<A extends unknown[]>(
  operation: OperationId,
  handler: (ctx: AuthContext, request: Request, ...rest: A) => Promise<Response>,
) {
  return async (request: Request, ...rest: A): Promise<Response> => {
    try {
      return await handler(await authorize(request, operation), request, ...rest);
    } catch (err) {
      return errorResponse(err);
    }
  };
}
