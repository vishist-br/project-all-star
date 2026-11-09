/** Stable machine-readable codes, matching the `Error` schema in docs/api/openapi.yaml. */
export type ErrorCode =
  | "validation_failed"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "payload_too_large"
  | "internal_error";

const STATUS: Record<ErrorCode, number> = {
  validation_failed: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  rate_limited: 429,
  payload_too_large: 413,
  internal_error: 500,
};

export type ErrorDetail = { field: string; message: string };

export class ApiError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: ErrorDetail[],
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

export function errorResponse(err: unknown): Response {
  if (err instanceof ApiError) {
    return Response.json(
      { error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } },
      { status: err.status },
    );
  }
  return Response.json({ error: { code: "internal_error", message: "Unexpected error" } }, { status: 500 });
}
