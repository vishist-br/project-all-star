"use server";
import { revalidatePath } from "next/cache";
import { replaceCoachAvailability } from "@/lib/api/availability";
import { recordAttendance } from "@/lib/api/attendance";
import { createSession, updateSession } from "@/lib/api/session-write";
import { ApiError } from "@/lib/auth/errors";
import { checkRole } from "@/lib/auth/guard";
import type { OperationId } from "@/lib/auth/policy";
import type { ActionResult } from "@/lib/plans/result";
import type { SessionDetail } from "@/lib/sessions/types";
import { getViewer } from "@/lib/viewer";

/**
 * Server actions for the coach session screens. They run with the viewer's own principal (tenant
 * and role come from the session, never from the browser), enforce the operation's role with
 * checkRole(), then call the same lib/api functions as the /api/v1 routes, which do the row-level
 * checks (a coach only reaches their own sessions). No bearer token reaches the browser.
 */
async function run<T>(operation: OperationId, fn: (ctx: Awaited<ReturnType<typeof getViewer>>) => Promise<T>): Promise<ActionResult<T>> {
  try {
    const viewer = await getViewer();
    checkRole(viewer.principal, operation);
    return { ok: true, data: await fn(viewer) };
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) };
    console.error("session action failed", err);
    return { ok: false, code: "internal_error", message: "Unexpected error" };
  }
}

function asBody(v: unknown): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new ApiError("validation_failed", "Body must be an object");
  return v as Record<string, unknown>;
}

function refresh() {
  revalidatePath("/[role]/today", "layout");
  revalidatePath("/[role]/sessions/[sessionId]", "page");
}

/** PUT /sessions/{id}/attendance. Idempotent: the same clientId with the same values is a no-op. */
export async function recordAttendanceAction(sessionId: string, body: unknown): Promise<ActionResult<SessionDetail>> {
  const result = await run("recordAttendance", async ({ db, principal }) =>
    (await recordAttendance(db, principal, String(sessionId), asBody(body))) as unknown as SessionDetail,
  );
  // No revalidatePath here: every tap would re-render the page. The screen refreshes after Complete.
  return result;
}

/** POST /sessions. */
export async function createSessionAction(body: unknown): Promise<ActionResult<SessionDetail>> {
  const result = await run("createSession", async ({ db, principal }) =>
    (await createSession(db, principal, asBody(body))) as unknown as SessionDetail,
  );
  if (result.ok) refresh();
  return result;
}

/** PATCH /sessions/{id}: reschedule, cancel or save the coach note. */
export async function updateSessionAction(sessionId: string, body: unknown): Promise<ActionResult<SessionDetail>> {
  const result = await run("updateSession", async ({ db, principal }) =>
    (await updateSession(db, principal, String(sessionId), asBody(body))) as unknown as SessionDetail,
  );
  if (result.ok) refresh();
  return result;
}

export type SavedSlot = { id: string; weekday: number; startTime: string; endTime: string; venueId: string | null };

/** PUT /coaches/{me}/availability. The coach id is always the signed-in coach. */
export async function saveAvailabilityAction(body: unknown): Promise<ActionResult<SavedSlot[]>> {
  const result = await run("replaceCoachAvailability", async ({ db, principal }) => {
    const res = await replaceCoachAvailability(db, principal, principal.userId, asBody(body));
    return res.slots as SavedSlot[];
  });
  if (result.ok) refresh();
  return result;
}
