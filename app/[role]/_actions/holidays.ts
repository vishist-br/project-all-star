"use server";
import { revalidatePath } from "next/cache";
import { createHoliday, deleteHoliday, type HolidayDto } from "@/lib/api/holidays";
import { ApiError } from "@/lib/auth/errors";
import { checkRole } from "@/lib/auth/guard";
import type { ActionResult } from "@/lib/plans/result";
import { getViewer } from "@/lib/viewer";

function failure(err: unknown, what: string): ActionResult<never> {
  if (err instanceof ApiError) return { ok: false, code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) };
  console.error(`${what} failed`, err instanceof Error ? err.message : err);
  return { ok: false, code: "internal_error", message: "Unexpected error" };
}

/** Adds a holiday or closure day as the viewer. Tenant and role come from the session; owner only (createHoliday). */
export async function addHolidayAction(input: { date: string; name: string }): Promise<ActionResult<HolidayDto>> {
  try {
    const { principal, db } = await getViewer();
    checkRole(principal, "createHoliday");
    const data = await createHoliday(db, principal.tenantId, { date: input?.date, name: input?.name });
    revalidatePath("/[role]/holidays", "page");
    return { ok: true, data };
  } catch (err) {
    return failure(err, "add holiday");
  }
}

/** Removes a holiday or closure day of the viewer's tenant; owner only (deleteHoliday). */
export async function removeHolidayAction(holidayId: string): Promise<ActionResult<{ id: string }>> {
  try {
    const { principal, db } = await getViewer();
    checkRole(principal, "deleteHoliday");
    await deleteHoliday(db, String(holidayId));
    revalidatePath("/[role]/holidays", "page");
    return { ok: true, data: { id: String(holidayId) } };
  } catch (err) {
    return failure(err, "remove holiday");
  }
}
