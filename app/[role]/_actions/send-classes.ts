"use server";
import { revalidatePath } from "next/cache";
import { updatePlanAssignment } from "@/lib/api/assignments";
import { recordAttendance } from "@/lib/api/attendance";
import { attachSessionWorkout, createClassSummaryShare, getSessionWorkout, publishClassSummary } from "@/lib/api/class-summary";
import { sendPlanToMembers } from "@/lib/api/bulk-send";
import { getWorkoutPlan, listWorkoutPlans } from "@/lib/api/workout-plans";
import { ApiError } from "@/lib/auth/errors";
import { checkRole } from "@/lib/auth/guard";
import type { OperationId } from "@/lib/auth/policy";
import type { ActionResult } from "@/lib/plans/result";
import type { MemberResult } from "@/lib/send/view";
import { getViewer } from "@/lib/viewer";

/**
 * Server actions for the send step, class workouts and class summaries (STAR-110). They run with the
 * viewer's own principal (tenant and role come from the session, never from the browser), enforce the
 * operation's role with checkRole() and call the same lib/api functions as the /api/v1 routes, which
 * do the row-level checks. No token reaches the browser.
 */
async function run<T>(operation: OperationId, fn: (ctx: Awaited<ReturnType<typeof getViewer>>) => Promise<T>): Promise<ActionResult<T>> {
  try {
    const viewer = await getViewer();
    checkRole(viewer.principal, operation);
    return { ok: true, data: await fn(viewer) };
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) };
    console.error("send/classes action failed", err);
    return { ok: false, code: "internal_error", message: "Unexpected error" };
  }
}

export type SendOutcome = {
  planId: string;
  planTitle: string;
  startsOn: string;
  endsOn: string | null;
  results: MemberResult[];
  sentCount: number;
  alreadySentCount: number;
  skippedCount: number;
};

/** POST /plan-assignments/bulk: one request, one result per member. Safe to repeat (same start date answers "already sent"). */
export async function sendPlanAction(payload: unknown): Promise<ActionResult<SendOutcome>> {
  const result = await run("sendPlanToMembers", async ({ db, principal }) => (await sendPlanToMembers(db, principal, payload)) as SendOutcome);
  if (result.ok) {
    revalidatePath("/[role]/plans", "page");
    revalidatePath("/[role]/members/[memberId]", "page");
  }
  return result;
}

/** PATCH /plan-assignments/{id} with a note: the coach's reply shows with the member's plan and in their updates. */
export async function replyWithNoteAction(assignmentId: string, note: string): Promise<ActionResult<{ ok: true }>> {
  const text = typeof note === "string" ? note.trim() : "";
  if (!text) return { ok: false, code: "validation_failed", message: "Note is empty" };
  const result = await run("updatePlanAssignment", async ({ db, principal }) => {
    await updatePlanAssignment(db, principal, String(assignmentId), { note: text.slice(0, 280) });
    return { ok: true as const };
  });
  if (result.ok) {
    revalidatePath("/[role]/plans/[planId]/results", "page");
    revalidatePath("/[role]/members/[memberId]", "page");
  }
  return result;
}

export type PlanChoice = { id: string; title: string; itemCount: number };
export type DayChoice = { id: string; title: string | null; index: number; exerciseCount: number };

/** Active plans of the viewer, for attaching a class workout. */
export async function listClassPlansAction(): Promise<ActionResult<PlanChoice[]>> {
  return run("listWorkoutPlans", async ({ db, principal }) => {
    const res = await listWorkoutPlans(db, principal, new URLSearchParams({ status: "active", limit: "50" }));
    return res.items.filter((p) => p.itemCount > 0).map((p) => ({ id: p.id, title: p.title, itemCount: p.itemCount }));
  });
}

/** Days of one plan that have at least one exercise. */
export async function listPlanDaysAction(planId: string): Promise<ActionResult<DayChoice[]>> {
  return run("getWorkoutPlan", async ({ db, principal }) => {
    const plan = await getWorkoutPlan(db, principal, String(planId));
    return plan.days
      .filter((d) => d.items.length > 0)
      .map((d, i) => ({ id: d.id, title: d.title, index: i + 1, exerciseCount: d.items.length }));
  });
}

export type ClassWorkoutInfo = { planDayId: string | null; planTitle: string | null; dayTitle: string | null; exerciseCount: number };

function toInfo(r: Awaited<ReturnType<typeof getSessionWorkout>>): ClassWorkoutInfo {
  const blocks = r.workout?.blocks ?? [];
  return {
    planDayId: r.planDayId,
    planTitle: r.workout?.planTitle ?? null,
    dayTitle: r.workout?.dayTitle ?? null,
    exerciseCount: blocks.reduce((n, b) => n + b.items.length, 0),
  };
}

/** PUT /sessions/{id}/workout. `null` detaches. */
export async function attachClassWorkoutAction(sessionId: string, planDayId: string | null): Promise<ActionResult<ClassWorkoutInfo>> {
  const result = await run("attachSessionWorkout", async ({ db, principal }) =>
    toInfo(await attachSessionWorkout(db, principal, String(sessionId), { planDayId })),
  );
  if (result.ok) revalidatePath("/[role]/sessions/[sessionId]", "page");
  return result;
}

export async function getClassWorkoutAction(sessionId: string): Promise<ActionResult<ClassWorkoutInfo>> {
  return run("getSessionWorkout", async ({ db, principal }) => toInfo(await getSessionWorkout(db, principal, String(sessionId))));
}

export type FinishBody = { entries: unknown[]; coachNote?: string | null; homePractice?: string | null };

/**
 * Finishes the roll call and publishes the class summary. Safe to repeat: marks replay by clientId, the
 * roll call completes once, and members are told once. A class with no workout publishes only when the
 * coach added a note or home practice.
 */
export async function finishClassAction(sessionId: string, body: FinishBody): Promise<ActionResult<{ published: boolean }>> {
  const id = String(sessionId);
  const coachNote = typeof body.coachNote === "string" && body.coachNote.trim() ? body.coachNote.trim().slice(0, 1000) : null;
  const homePractice = typeof body.homePractice === "string" && body.homePractice.trim() ? body.homePractice.trim().slice(0, 1000) : null;
  const done = await run("recordAttendance", async ({ db, principal }) => {
    await recordAttendance(db, principal, id, { entries: body.entries, complete: true, coachNote });
    const workout = await getSessionWorkout(db, principal, id);
    const hasContent = Boolean(workout.planDayId) || coachNote !== null || homePractice !== null;
    if (!hasContent) return { published: false };
    checkRole(principal, "publishClassSummary");
    await publishClassSummary(db, principal, id, { coachNote, homePractice });
    return { published: true };
  });
  if (done.ok) {
    revalidatePath("/[role]/today", "layout");
    revalidatePath("/[role]/sessions/[sessionId]", "page");
  }
  return done;
}

/** POST /sessions/{id}/summary/shares: a 30-day family link for one member's summary. */
export async function shareClassSummaryAction(sessionId: string, memberId: string): Promise<ActionResult<{ url: string; expiresAt: string }>> {
  return run("createClassSummaryShare", async ({ db, principal }) => createClassSummaryShare(db, principal, String(sessionId), { memberId: String(memberId) }));
}
