import { ApiError } from "../auth/errors";

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

/** `?limit=` per the contract: integer 1..100, default 25. Anything else is a 400. */
export function parseLimit(params: URLSearchParams): number {
  const raw = params.get("limit");
  if (raw === null || raw === "") return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) {
    throw new ApiError("validation_failed", `limit must be an integer between 1 and ${MAX_LIMIT}`, [
      { field: "limit", message: `Integer 1..${MAX_LIMIT}` },
    ]);
  }
  return n;
}

/** Opaque cursor: the id of the last row of the previous page. */
export function encodeCursor(id: string): string {
  return Buffer.from(id, "utf8").toString("base64url");
}

export function parseCursor(params: URLSearchParams): string | undefined {
  const raw = params.get("cursor");
  if (raw === null || raw === "") return undefined;
  const id = Buffer.from(raw, "base64url").toString("utf8");
  if (!id || id.length > 100 || encodeCursor(id) !== raw) {
    throw new ApiError("validation_failed", "cursor is not valid", [{ field: "cursor", message: "Invalid cursor" }]);
  }
  return id;
}

/** Prisma paging args: fetch `limit + 1` rows so we know whether another page exists. */
export function pageArgs(params: URLSearchParams) {
  const limit = parseLimit(params);
  const cursor = parseCursor(params);
  return { limit, args: { take: limit + 1, ...(cursor ? { cursor: { id: cursor } } : {}) } };
}

export function toPage<T extends { id: string }>(rows: T[], limit: number): { rows: T[]; nextCursor: string | null } {
  if (rows.length <= limit) return { rows, nextCursor: null };
  // The extra row is the first row of the next page, so the cursor points at it.
  return { rows: rows.slice(0, limit), nextCursor: encodeCursor(rows[limit].id) };
}

export function enumParam<T extends string>(params: URLSearchParams, name: string, allowed: readonly T[]): T | undefined {
  const v = params.get(name);
  if (v === null || v === "") return undefined;
  if (!(allowed as readonly string[]).includes(v)) {
    throw new ApiError("validation_failed", `${name} must be one of: ${allowed.join(", ")}`, [
      { field: name, message: `One of ${allowed.join(", ")}` },
    ]);
  }
  return v as T;
}

const TZ_OFFSET = "+05:30"; // every POC tenant is Asia/Kolkata (see /tenant)

/** `YYYY-MM-DD` (tenant timezone) to the start instant of that day. */
export function dateParam(params: URLSearchParams, name: string): Date | undefined {
  const v = params.get(name);
  if (v === null || v === "") return undefined;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00${TZ_OFFSET}`) : null;
  if (!d || Number.isNaN(d.getTime())) {
    throw new ApiError("validation_failed", `${name} must be a date (YYYY-MM-DD)`, [
      { field: name, message: "Date YYYY-MM-DD" },
    ]);
  }
  return d;
}

/** Tenant-timezone calendar date (`YYYY-MM-DD`) of an instant. */
export function tenantDate(d: Date): string {
  return new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}
