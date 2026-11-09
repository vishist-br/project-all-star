import { ApiError } from "./errors";

/** Parse a JSON object body or throw validation_failed. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiError("validation_failed", "Body must be valid JSON");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ApiError("validation_failed", "Body must be a JSON object");
  }
  return body as Record<string, unknown>;
}

export function requireString(body: Record<string, unknown>, field: string): string {
  const v = body[field];
  if (typeof v !== "string" || v.length === 0) {
    throw new ApiError("validation_failed", `${field} is required`, [{ field, message: "Required string" }]);
  }
  return v;
}
