"use server";
import { revalidatePath } from "next/cache";
import { loadTenantSettings, updateTenantSettings } from "@/lib/api/tenant-settings";
import { ApiError } from "@/lib/auth/errors";
import { checkRole } from "@/lib/auth/guard";
import type { ActionResult } from "@/lib/plans/result";
import { getViewer } from "@/lib/viewer";
import { parseCancelWindow, type BookingRules } from "@/components/owner/settings/view-model";

/**
 * Saves the booking rules as the signed-in viewer. Tenant and role come from the session, never from
 * the browser; checkRole() allows only the owner (updateTenantSettings). No token reaches the client.
 */
export async function saveBookingRulesAction(input: { cancelWindow: string; waitlistEnabled: boolean; showMissedSessionCost: boolean }): Promise<ActionResult<BookingRules>> {
  try {
    const { principal, db } = await getViewer();
    checkRole(principal, "updateTenantSettings");
    const w = parseCancelWindow(input?.cancelWindow);
    if (!w.ok) throw new ApiError("validation_failed", `bookingCancelWindowMinutes: ${w.error}`, [{ field: "bookingCancelWindowMinutes", message: w.error }]);
    await updateTenantSettings(db, principal.tenantId, {
      bookingCancelWindowMinutes: w.value,
      waitlistEnabled: input.waitlistEnabled === true,
      showMissedSessionCost: input.showMissedSessionCost === true,
    });
    revalidatePath("/[role]/settings", "page");
    return { ok: true, data: await loadTenantSettings(db) };
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) };
    console.error("save booking rules failed", err instanceof Error ? err.message : err);
    return { ok: false, code: "internal_error", message: "Unexpected error" };
  }
}
