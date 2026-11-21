"use server";
import { revalidatePath } from "next/cache";
import { addGoalCheckIn, createGoal, updateGoal } from "@/lib/api/goals";
import { ApiError } from "@/lib/auth/errors";
import { checkRole } from "@/lib/auth/guard";
import type { OperationId } from "@/lib/auth/policy";
import type { ActionResult } from "@/lib/plans/result";
import { getViewer } from "@/lib/viewer";

/**
 * Goal actions for the member detail page. They run on the server with the viewer's own
 * principal (tenant and role come from the session), check the operation's role and call the
 * same lib/api functions as the /api/v1 routes. No token ever reaches the browser.
 */
async function run<T>(operation: OperationId, fn: (ctx: Awaited<ReturnType<typeof getViewer>>) => Promise<T>): Promise<ActionResult<T>> {
  try {
    const viewer = await getViewer();
    checkRole(viewer.principal, operation);
    return { ok: true, data: await fn(viewer) };
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) };
    console.error("goal action failed", err);
    return { ok: false, code: "internal_error", message: "Unexpected error" };
  }
}

export type GoalSaved = { id: string; status: string };

export async function createGoalAction(memberId: string, payload: unknown): Promise<ActionResult<GoalSaved>> {
  const result = await run("createGoal", async ({ db, principal }) => {
    const g = await createGoal(db, principal, String(memberId), payload);
    return { id: g.id, status: g.status };
  });
  if (result.ok) revalidatePath("/[role]/members/[memberId]", "page");
  return result;
}

export async function setGoalStatusAction(goalId: string, status: "active" | "achieved" | "dropped"): Promise<ActionResult<GoalSaved>> {
  const result = await run("updateGoal", async ({ db, principal }) => {
    const g = await updateGoal(db, principal, String(goalId), { status });
    return { id: g.id, status: g.status };
  });
  if (result.ok) revalidatePath("/[role]/members/[memberId]", "page");
  return result;
}

export async function addGoalCheckInAction(goalId: string, payload: unknown): Promise<ActionResult<GoalSaved>> {
  const result = await run("addGoalCheckIn", async ({ db, principal }) => {
    const g = await addGoalCheckIn(db, principal, String(goalId), payload);
    return { id: g.id, status: g.status };
  });
  if (result.ok) revalidatePath("/[role]/members/[memberId]", "page");
  return result;
}
