"use server";
import { revalidatePath } from "next/cache";
import { createCoachCredential, deleteCoachCredential, setCoachCredentialVerification, type CredentialDto } from "@/lib/api/coach-credentials";
import { ApiError } from "@/lib/auth/errors";
import { checkRole } from "@/lib/auth/guard";
import type { ActionResult } from "@/lib/plans/result";
import { getViewer } from "@/lib/viewer";

function failure(err: unknown, what: string): ActionResult<never> {
  if (err instanceof ApiError) return { ok: false, code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) };
  console.error(`${what} failed`, err instanceof Error ? err.message : err);
  return { ok: false, code: "internal_error", message: "Unexpected error" };
}

function refresh() {
  revalidatePath("/[role]/coaches", "layout");
  revalidatePath("/[role]/record", "page");
  revalidatePath("/[role]/profile", "page");
}

/** Adds a claimed credential (unverified) for a coach. The coach adds their own; role and row rules live in createCoachCredential. */
export async function addCredentialAction(coachId: string, input: { title: string; issuer?: string; year?: number | null }): Promise<ActionResult<CredentialDto>> {
  try {
    const { principal, db } = await getViewer();
    checkRole(principal, "createCoachCredential");
    const body: Record<string, unknown> = { title: input?.title };
    if (input?.issuer) body.issuer = input.issuer;
    if (typeof input?.year === "number") body.year = input.year;
    const data = await createCoachCredential(db, principal, String(coachId), body);
    refresh();
    return { ok: true, data };
  } catch (err) {
    return failure(err, "add credential");
  }
}

/** Owner marks a credential verified or unverified. */
export async function setCredentialVerifiedAction(credentialId: string, verified: boolean): Promise<ActionResult<CredentialDto>> {
  try {
    const { principal, db } = await getViewer();
    checkRole(principal, "setCoachCredentialVerification");
    const data = await setCoachCredentialVerification(db, principal, String(credentialId), { verified });
    refresh();
    return { ok: true, data };
  } catch (err) {
    return failure(err, "verify credential");
  }
}

/** Removes a credential: owner any, coach their own. */
export async function removeCredentialAction(credentialId: string): Promise<ActionResult<{ id: string }>> {
  try {
    const { principal, db } = await getViewer();
    checkRole(principal, "deleteCoachCredential");
    await deleteCoachCredential(db, principal, String(credentialId));
    refresh();
    return { ok: true, data: { id: String(credentialId) } };
  } catch (err) {
    return failure(err, "remove credential");
  }
}
