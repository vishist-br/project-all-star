"use server";
import { revalidatePath } from "next/cache";
import {
  createProgressCardLink,
  revokeProgressCardLink,
  saveProgressNote,
  type ProgressCardLinkDto,
  type ProgressNoteDto,
} from "@/lib/api/progress-card";
import { ApiError } from "@/lib/auth/errors";
import { checkRole } from "@/lib/auth/guard";
import type { OperationId } from "@/lib/auth/policy";
import type { ActionResult } from "@/lib/plans/result";
import { getViewer } from "@/lib/viewer";

/** What the browser gets back for a new link: the same-origin path (the browser adds its own origin) and display fields. No hash, no tenant id. */
export type SharedLink = { id: string; path: string; weekStart: string; expiresAt: string };

/** Runs with the viewer's own principal (tenant and role from the session) and the same lib/api rules as the /api/v1 routes. */
async function run<T>(operation: OperationId, fn: (ctx: Awaited<ReturnType<typeof getViewer>>) => Promise<T>): Promise<ActionResult<T>> {
  try {
    const viewer = await getViewer();
    checkRole(viewer.principal, operation);
    return { ok: true, data: await fn(viewer) };
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) };
    console.error("progress card action failed", err);
    return { ok: false, code: "internal_error", message: "Unexpected error" };
  }
}

/** Coach (own members) or owner: write, replace or (empty text) remove the note for a week. */
export async function saveProgressNoteAction(memberId: string, week: string, note: string): Promise<ActionResult<ProgressNoteDto>> {
  const res = await run("saveProgressNote", ({ db, principal }) => saveProgressNote(db, principal, String(memberId), { week, note: String(note) }));
  if (res.ok) revalidatePath("/customer/progress/week");
  return res;
}

/** Create a shareable link for the card of one week. The token only leaves the server inside the path returned here, once. */
export async function createCardLinkAction(memberId: string, week: string): Promise<ActionResult<SharedLink>> {
  const res = await run("createProgressCardLink", async ({ db, principal }) => {
    const l = await createProgressCardLink(db, principal, String(memberId), { week });
    return { id: l.id, path: l.path, weekStart: l.weekStart, expiresAt: l.expiresAt };
  });
  if (res.ok) revalidatePath("/customer/progress/week");
  return res;
}

export async function revokeCardLinkAction(linkId: string): Promise<ActionResult<ProgressCardLinkDto>> {
  const res = await run("revokeProgressCardLink", ({ db, principal }) => revokeProgressCardLink(db, principal, String(linkId)));
  if (res.ok) revalidatePath("/customer/progress/week");
  return res;
}
