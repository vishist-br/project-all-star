import { ApiError, type ErrorDetail } from "../auth/errors";

/** Collects field errors, then throws one `validation_failed` with details. */
export class Problems {
  readonly list: ErrorDetail[] = [];
  add(field: string, message: string) {
    this.list.push({ field, message });
  }
  throwIfAny(message = "Request body is not valid") {
    if (this.list.length > 0) throw new ApiError("validation_failed", message, this.list);
  }
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Real calendar date `YYYY-MM-DD`. */
export function isDateString(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function dateToDb(v: string): Date {
  return new Date(`${v}T00:00:00Z`);
}

export function dateFromDb(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Optional integer within [min, max]; null/undefined mean "not set". Returns undefined when absent. */
export function intField(
  p: Problems,
  obj: Record<string, unknown>,
  key: string,
  path: string,
  min: number,
  max: number,
): number | null {
  const v = obj[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
    p.add(`${path}.${key}`, `Integer ${min}..${max}`);
    return null;
  }
  return v;
}

/** Optional string (nullable) with a max length. */
export function textField(
  p: Problems,
  obj: Record<string, unknown>,
  key: string,
  path: string,
  max: number,
): string | null {
  const v = obj[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== "string" || v.length > max) {
    p.add(path ? `${path}.${key}` : key, `Text up to ${max} characters`);
    return null;
  }
  return v;
}
