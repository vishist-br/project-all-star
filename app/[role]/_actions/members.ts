"use server";
import { revalidatePath } from "next/cache";
import { updatePlanAssignment } from "@/lib/api/assignments";
import { ApiError } from "@/lib/auth/errors";
import { checkRole } from "@/lib/auth/guard";
import type { OperationId } from "@/lib/auth/policy";
import { createMemberMagicLink, type MemberMagicLinkDto } from "@/lib/auth/member-link";
import type { ActionResult } from "@/lib/plans/result";
import { getViewer } from "@/lib/viewer";

/** Member detail actions (assignment status, sign-in link). Same pattern as _actions/goals.ts: server only, viewer principal, role checked. */
async function run<T>(operation: OperationId, fn: (ctx: Awaited<ReturnType<typeof getViewer>>) => Promise<T>): Promise<ActionResult<T>> {
  try {
    const viewer = await getViewer();
    checkRole(viewer.principal, operation);
    return { ok: true, data: await fn(viewer) };
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) };
    console.error("member action failed", err);
    return { ok: false, code: "internal_error", message: "Unexpected error" };
  }
}

/** Pause, resume or end a plan assignment. */
export async function setAssignmentStatusAction(assignmentId: string, status: "active" | "paused" | "ended"): Promise<ActionResult<{ id: string; status: string }>> {
  const result = await run("updatePlanAssignment", async ({ db, principal }) => {
    await updatePlanAssignment(db, principal, String(assignmentId), { status });
    return { id: String(assignmentId), status };
  });
  if (result.ok) {
    revalidatePath("/[role]/members/[memberId]", "page");
    revalidatePath("/[role]/plans", "page");
  }
  return result;
}

/** One-time sign-in link for the member (or the guardian of a child). The URL is returned to the page once and never stored there. */
export async function createSignInLinkAction(memberId: string): Promise<ActionResult<MemberMagicLinkDto>> {
  return run("createMemberMagicLink", ({ db, principal }) => createMemberMagicLink(db, principal, String(memberId)));
}
