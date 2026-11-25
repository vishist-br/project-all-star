"use server";
import { revalidatePath } from "next/cache";
import { createPlanFolder, deletePlanFolder, renamePlanFolder } from "@/lib/api/plan-folders";
import { duplicatePlan, movePlanToFolder } from "@/lib/api/workout-plans";
import { deleteBodyMeasurement, recordBodyMeasurement } from "@/lib/api/body-measurements";
import { ApiError } from "@/lib/auth/errors";
import { checkRole } from "@/lib/auth/guard";
import type { OperationId } from "@/lib/auth/policy";
import type { ActionResult } from "@/lib/plans/result";
import { getViewer } from "@/lib/viewer";

/**
 * Server actions for the plans library (folders, templates, duplicate, move) and for the customer's
 * body measurements (STAR-114). Same pattern as _actions/plans.ts: the viewer's own principal, the
 * operation's role check, then the lib/api function the /api/v1 route uses.
 */
async function run<T>(operation: OperationId, fn: (ctx: Awaited<ReturnType<typeof getViewer>>) => Promise<T>): Promise<ActionResult<T>> {
  try {
    const viewer = await getViewer();
    checkRole(viewer.principal, operation);
    return { ok: true, data: await fn(viewer) };
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) };
    console.error("plans library action failed", err);
    return { ok: false, code: "internal_error", message: "Unexpected error" };
  }
}

const refresh = () => revalidatePath("/[role]/plans", "page");

export async function createFolderAction(name: string): Promise<ActionResult<{ id: string }>> {
  const res = await run("createPlanFolder", async ({ db, principal }) => ({ id: (await createPlanFolder(db, principal, { name })).id }));
  if (res.ok) refresh();
  return res;
}

export async function renameFolderAction(folderId: string, name: string): Promise<ActionResult<{ id: string }>> {
  const res = await run("renamePlanFolder", async ({ db, principal }) => ({ id: (await renamePlanFolder(db, principal, folderId, { name })).id }));
  if (res.ok) refresh();
  return res;
}

export async function deleteFolderAction(folderId: string): Promise<ActionResult<{ ok: true }>> {
  const res = await run("deletePlanFolder", async ({ db, principal }) => {
    await deletePlanFolder(db, principal, folderId);
    return { ok: true as const };
  });
  if (res.ok) refresh();
  return res;
}

export async function movePlanAction(planId: string, folderId: string | null): Promise<ActionResult<{ id: string }>> {
  const res = await run("movePlanToFolder", async ({ db, principal }) => ({ id: (await movePlanToFolder(db, principal, planId, { folderId })).id }));
  if (res.ok) refresh();
  return res;
}

/** Copies a plan (`asTemplate` true saves a template) or, for a template, makes a plan from it. Returns the new plan id. */
export async function duplicatePlanAction(planId: string, opts: { asTemplate?: boolean; title?: string }): Promise<ActionResult<{ id: string }>> {
  const res = await run("duplicatePlan", async ({ db, principal }) => ({
    id: (await duplicatePlan(db, principal, planId, { asTemplate: Boolean(opts.asTemplate), ...(opts.title ? { title: opts.title } : {}) })).id,
  }));
  if (res.ok) refresh();
  return res;
}

export async function recordMeasurementAction(memberId: string, payload: unknown): Promise<ActionResult<{ id: string }>> {
  const res = await run("recordBodyMeasurement", async ({ db, principal }) => ({ id: (await recordBodyMeasurement(db, principal, memberId, payload)).id }));
  if (res.ok) revalidatePath("/customer/progress/body");
  return res;
}

export async function deleteMeasurementAction(memberId: string, measurementId: string): Promise<ActionResult<{ ok: true }>> {
  const res = await run("deleteBodyMeasurement", async ({ db, principal }) => {
    await deleteBodyMeasurement(db, principal, memberId, measurementId);
    return { ok: true as const };
  });
  if (res.ok) revalidatePath("/customer/progress/body");
  return res;
}
