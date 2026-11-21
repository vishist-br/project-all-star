import { ApiError, errorResponse } from "@/lib/auth/errors";
import { checkRole } from "@/lib/auth/guard";
import { readJsonObject } from "@/lib/auth/http";
import { recordWorkoutLog } from "@/lib/api/workout-logs";
import { getSessionOrNull } from "@/lib/session";
import { getViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

/**
 * Same-origin bridge for the customer's start/stop/complete/skip taps and the offline queue replay.
 * The browser never holds a bearer token: the viewer principal comes from the httpOnly session
 * cookie (or the demo switcher) and the request goes to the same recordWorkoutLog the API route
 * uses, so role, tenant and "only your own or your child's data" are enforced identically.
 * Answers 401 (not a redirect) without a session so the queue keeps its entries.
 */
export async function PUT(request: Request) {
  try {
    if (!(request.headers.get("content-type") ?? "").includes("application/json")) {
      throw new ApiError("validation_failed", "Send JSON");
    }
    if (!(await getSessionOrNull())) throw new ApiError("unauthorized", "Sign in first");
    const { principal, db } = await getViewer();
    checkRole(principal, "recordWorkoutLog");
    return Response.json(await recordWorkoutLog(db, principal, await readJsonObject(request)));
  } catch (err) {
    return errorResponse(err);
  }
}
