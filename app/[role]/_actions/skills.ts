"use server";
import { revalidatePath } from "next/cache";
import { clearSkillSignOff, signOffSkill } from "@/lib/api/skills";
import { ApiError } from "@/lib/auth/errors";
import { checkRole } from "@/lib/auth/guard";
import type { OperationId } from "@/lib/auth/policy";
import type { ActionResult } from "@/lib/plans/result";
import { getViewer } from "@/lib/viewer";

/**
 * Skill sign-off actions for the member page. They run on the server as the viewer (coach: own members,
 * owner: any member), check the operation's role and call the same lib/api functions as the API routes.
 */
async function run(operation: OperationId, fn: (ctx: Awaited<ReturnType<typeof getViewer>>) => Promise<void>): Promise<ActionResult<{ ok: true }>> {
  try {
    const viewer = await getViewer();
    checkRole(viewer.principal, operation);
    await fn(viewer);
    revalidatePath("/[role]/members/[memberId]", "page");
    return { ok: true, data: { ok: true } };
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) };
    console.error("skill action failed", err);
    return { ok: false, code: "internal_error", message: "Unexpected error" };
  }
}

export async function signOffSkillAction(memberId: string, skillItemId: string, rating: number): Promise<ActionResult<{ ok: true }>> {
  return run("signOffSkill", async ({ db, principal }) => {
    await signOffSkill(db, principal, String(memberId), String(skillItemId), { rating });
  });
}

export async function clearSkillSignOffAction(memberId: string, skillItemId: string): Promise<ActionResult<{ ok: true }>> {
  return run("clearSkillSignOff", async ({ db, principal }) => {
    await clearSkillSignOff(db, principal, String(memberId), String(skillItemId));
  });
}
