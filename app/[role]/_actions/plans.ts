"use server";
import { revalidatePath } from "next/cache";
import { createPlanAssignments } from "@/lib/api/assignments";
import { getExercise, listExercises } from "@/lib/api/exercises";
import { listMembers } from "@/lib/api/members";
import { archiveWorkoutPlan, createWorkoutPlan, updateWorkoutPlan } from "@/lib/api/workout-plans";
import { ApiError } from "@/lib/auth/errors";
import { checkRole } from "@/lib/auth/guard";
import type { OperationId } from "@/lib/auth/policy";
import type { ActionResult, AssignOutcome, ExerciseDetail, ExercisePage, MemberOption, PlanSaved } from "@/lib/plans/result";
import { getViewer } from "@/lib/viewer";

/**
 * Server actions for the plan screens. They run on the server with the viewer's own principal
 * (tenant and role come from the session, never from the browser), enforce the operation's role
 * with checkRole() and then call the same lib/api functions as the /api/v1 routes. No bearer
 * token ever reaches the browser.
 */
async function run<T>(operation: OperationId, fn: (ctx: Awaited<ReturnType<typeof getViewer>>) => Promise<T>): Promise<ActionResult<T>> {
  try {
    const viewer = await getViewer();
    checkRole(viewer.principal, operation);
    return { ok: true, data: await fn(viewer) };
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) };
    console.error("plan action failed", err);
    return { ok: false, code: "internal_error", message: "Unexpected error" };
  }
}

const saved = (p: { id: string; version: number; status: string }): PlanSaved => ({ id: p.id, version: p.version, status: p.status });

export async function createPlanAction(payload: unknown): Promise<ActionResult<PlanSaved>> {
  const result = await run("createWorkoutPlan", async ({ db, principal }) => saved(await createWorkoutPlan(db, principal, payload)));
  if (result.ok) revalidatePath("/[role]/plans", "page");
  return result;
}

export async function updatePlanAction(planId: string, payload: unknown): Promise<ActionResult<PlanSaved>> {
  const result = await run("updateWorkoutPlan", async ({ db, principal }) => saved(await updateWorkoutPlan(db, principal, planId, payload)));
  if (result.ok) revalidatePath("/[role]/plans", "page");
  return result;
}

export async function archivePlanAction(planId: string): Promise<ActionResult<PlanSaved>> {
  const result = await run("archiveWorkoutPlan", async ({ db, principal }) => saved(await archiveWorkoutPlan(db, principal, planId)));
  if (result.ok) revalidatePath("/[role]/plans", "page");
  return result;
}

export async function searchExercisesAction(filters: { q?: string; sport?: string; muscle?: string; equipment?: string; cursor?: string }): Promise<ActionResult<ExercisePage>> {
  return run("listExercises", async ({ db }) => {
    const params = new URLSearchParams({ limit: "20" });
    for (const k of ["q", "sport", "muscle", "equipment", "cursor"] as const) if (filters[k]) params.set(k, String(filters[k]).slice(0, 100));
    return (await listExercises(db, params)) as ExercisePage;
  });
}

export async function getExerciseAction(id: string): Promise<ActionResult<ExerciseDetail>> {
  return run("getExercise", async ({ db }) => (await getExercise(db, String(id))) as ExerciseDetail);
}

/** Members the viewer can assign to: a coach sees members of their own batches, the owner everyone. */
export async function listAssignableMembersAction(q?: string): Promise<ActionResult<MemberOption[]>> {
  return run("listMembers", async ({ db, principal }) => {
    const out: MemberOption[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page += 1) {
      const params = new URLSearchParams({ limit: "100", status: "active" });
      if (q) params.set("q", q.slice(0, 80));
      if (cursor) params.set("cursor", cursor);
      const res: Awaited<ReturnType<typeof listMembers>> = await listMembers(db, principal, params);
      out.push(...res.items.map((m) => ({ id: m.id, name: m.name, level: m.level })));
      cursor = res.nextCursor;
      if (!cursor) break;
    }
    return out;
  });
}

/**
 * Assigns the plan to each member separately so one problem (for example "already assigned")
 * does not block the others; the outcome lists every member with its own message.
 */
export async function assignPlanAction(input: {
  planId: string;
  members: { id: string; name: string }[];
  startsOn: string;
  endsOn: string | null;
  note: string | null;
}): Promise<ActionResult<AssignOutcome[]>> {
  const result = await run("createPlanAssignments", async ({ db, principal }) => {
    const outcomes: AssignOutcome[] = [];
    for (const m of input.members.slice(0, 50)) {
      try {
        await createPlanAssignments(db, principal, {
          planId: input.planId,
          memberIds: [m.id],
          startsOn: input.startsOn,
          endsOn: input.endsOn,
          note: input.note,
        });
        outcomes.push({ memberId: m.id, name: m.name, ok: true });
      } catch (err) {
        if (err instanceof ApiError) {
          // Bad dates or text apply to everyone, so report them once instead of per member.
          if (err.code === "validation_failed") throw err;
          outcomes.push({ memberId: m.id, name: m.name, ok: false, code: err.code, message: err.message });
        } else throw err;
      }
    }
    return outcomes;
  });
  if (result.ok) revalidatePath("/[role]/plans", "page");
  return result;
}
