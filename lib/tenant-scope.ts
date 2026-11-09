import { Prisma, type PrismaClient } from "@prisma/client";

/**
 * Tenant-scoped data access.
 *
 * `forTenant(prisma, tenantId)` returns a client where every query on a tenant-owned
 * model is forced to the caller's tenant:
 *  - reads / updates / deletes / counts / aggregates get `tenantId` ANDed into `where`
 *  - creates get `tenantId` injected; a conflicting `tenantId` in the data throws
 *  - updates cannot move a row to another tenant
 *
 * A model is tenant-owned when it has a `tenantId` field (every model except Tenant).
 * Limitation: relation ids you pass (e.g. a venueId) are not verified to belong to the
 * same tenant here; resolve them through the scoped client first (a findFirst on the
 * scoped client returns null for another tenant's row).
 */

export class TenantScopeError extends Error {}

type Args = Record<string, unknown>;

const tenantModels = new Set(
  Prisma.dmmf.datamodel.models
    .filter((m) => m.fields.some((f) => f.name === "tenantId"))
    .map((m) => m.name),
);

export function isTenantModel(model: string): boolean {
  return tenantModels.has(model);
}

function assertTenantId(tenantId: string): void {
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    throw new TenantScopeError("forTenant requires a non-empty tenantId");
  }
}

/** Unique-lookup operations need tenantId as a sibling key (extendedWhereUnique), not in AND. */
function scopeUniqueWhere(where: unknown, tenantId: string): Args {
  const w = (where ?? {}) as Args;
  if ("tenantId" in w && w.tenantId !== undefined && w.tenantId !== tenantId) {
    throw new TenantScopeError("where.tenantId does not match the scoped tenant");
  }
  return { ...w, tenantId };
}

function scopeWhere(where: unknown, tenantId: string): Args {
  const w = (where ?? {}) as Args;
  if ("tenantId" in w && w.tenantId !== undefined && w.tenantId !== tenantId) {
    throw new TenantScopeError("where.tenantId does not match the scoped tenant");
  }
  return { AND: [w, { tenantId }] };
}

function scopeCreateData(data: unknown, tenantId: string): Args {
  const d = (data ?? {}) as Args;
  if ("tenantId" in d && d.tenantId !== undefined && d.tenantId !== tenantId) {
    throw new TenantScopeError("data.tenantId does not match the scoped tenant");
  }
  if ("tenant" in d) {
    throw new TenantScopeError("set tenancy via the scoped client, not a tenant relation");
  }
  return { ...d, tenantId };
}

function scopeUpdateData(data: unknown, tenantId: string): Args {
  const d = (data ?? {}) as Args;
  if ("tenantId" in d && d.tenantId !== undefined && d.tenantId !== tenantId) {
    throw new TenantScopeError("data.tenantId does not match the scoped tenant");
  }
  if ("tenant" in d) {
    throw new TenantScopeError("a row cannot be moved to another tenant");
  }
  return d;
}

/** Pure args rewrite, exported so it can be unit tested without a database. */
export function scopeArgs(operation: string, args: unknown, tenantId: string): Args {
  assertTenantId(tenantId);
  const a = { ...((args ?? {}) as Args) };
  switch (operation) {
    case "findUnique":
    case "findUniqueOrThrow":
    case "delete":
      a.where = scopeUniqueWhere(a.where, tenantId);
      return a;
    case "findFirst":
    case "findFirstOrThrow":
    case "findMany":
    case "count":
    case "aggregate":
    case "groupBy":
    case "deleteMany":
      a.where = scopeWhere(a.where, tenantId);
      return a;
    case "update":
      a.where = scopeUniqueWhere(a.where, tenantId);
      a.data = scopeUpdateData(a.data, tenantId);
      return a;
    case "updateMany":
      a.where = scopeWhere(a.where, tenantId);
      a.data = scopeUpdateData(a.data, tenantId);
      return a;
    case "create":
      a.data = scopeCreateData(a.data, tenantId);
      return a;
    case "createMany":
    case "createManyAndReturn":
      a.data = Array.isArray(a.data)
        ? a.data.map((row) => scopeCreateData(row, tenantId))
        : scopeCreateData(a.data, tenantId);
      return a;
    case "upsert":
      a.where = scopeUniqueWhere(a.where, tenantId);
      a.create = scopeCreateData(a.create, tenantId);
      a.update = scopeUpdateData(a.update, tenantId);
      return a;
    default:
      throw new TenantScopeError(`operation "${operation}" is not allowed on a tenant-scoped client`);
  }
}

export function forTenant(prisma: PrismaClient, tenantId: string) {
  assertTenantId(tenantId);
  return prisma.$extends({
    name: "tenant-scope",
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          if (!isTenantModel(model)) return query(args);
          return query(scopeArgs(operation, args, tenantId) as typeof args);
        },
      },
    },
  });
}

export type TenantClient = ReturnType<typeof forTenant>;
