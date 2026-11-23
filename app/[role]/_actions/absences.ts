"use server";
import { revalidatePath } from "next/cache";
import { cancelExcusedAbsence, createExcusedAbsence, type ExcusedAbsenceDto } from "@/lib/api/excused-absences";
import { ApiError } from "@/lib/auth/errors";
import { allow, getCustomerContext } from "@/lib/customer/server";
import type { ActionResult } from "@/lib/plans/result";

/** What the browser may send. The member is checked against the signed-in family on the server. */
export type DeclareInput = {
  memberId: string;
  sessionId?: string;
  fromDate?: string;
  toDate?: string;
  reason: string;
  note?: string;
};

function failure(err: unknown): ActionResult<never> {
  if (err instanceof ApiError) return { ok: false, code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) };
  console.error("absence action failed", err);
  return { ok: false, code: "internal_error", message: "Unexpected error" };
}

/** Tell the coach ahead of time that a session or a date range will be missed. Same rules as POST /members/{id}/excused-absences. */
export async function declareAbsenceAction(input: DeclareInput): Promise<ActionResult<ExcusedAbsenceDto>> {
  try {
    const { principal, db, children } = await getCustomerContext();
    if (!children.some((c) => c.id === input.memberId)) return { ok: false, code: "forbidden", message: "Not one of your family" };
    allow(principal, "createExcusedAbsence");
    const { memberId, ...rest } = input;
    const body: Record<string, unknown> = { ...rest };
    for (const k of Object.keys(body)) if (body[k] === undefined || body[k] === "") delete body[k];
    const data = await createExcusedAbsence(db, principal, memberId, body);
    revalidatePath("/customer/absences");
    return { ok: true, data };
  } catch (err) {
    return failure(err);
  }
}

/** Withdraw a declared absence. */
export async function withdrawAbsenceAction(absenceId: string): Promise<ActionResult<ExcusedAbsenceDto>> {
  try {
    const { principal, db } = await getCustomerContext();
    allow(principal, "cancelExcusedAbsence");
    const data = await cancelExcusedAbsence(db, principal, absenceId);
    revalidatePath("/customer/absences");
    return { ok: true, data };
  } catch (err) {
    return failure(err);
  }
}
