import { ApiError, errorResponse } from "@/lib/auth/errors";
import { checkRole } from "@/lib/auth/guard";
import { readJsonObject } from "@/lib/auth/http";
import { recordWorkoutSets } from "@/lib/api/workout-sets";
import { getSessionOrNull } from "@/lib/session";
import { getViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

/**
 * Same-origin bridge for the live workout: each ticked set and the offline queue replay go to the
 * same recordWorkoutSets the API route uses. Like /ui/workout-log, the browser holds no bearer
 * token (the principal comes from the session cookie or the demo switcher) and a missing session
 * answers 401, not a redirect, so the queue keeps its entries.
 */
export async function PUT(request: Request) {
  try {
    if (!(request.headers.get("content-type") ?? "").includes("application/json")) {
      throw new ApiError("validation_failed", "Send JSON");
    }
    if (!(await getSessionOrNull())) throw new ApiError("unauthorized", "Sign in first");
    const { principal, db } = await getViewer();
    checkRole(principal, "recordWorkoutSets");
    return Response.json(await recordWorkoutSets(db, principal, await readJsonObject(request)));
  } catch (err) {
    return errorResponse(err);
  }
}
