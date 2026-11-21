/** Booking-rule form parsing and validation (pure). Mirrors updateTenantSettings: integer 0..2880. */

export const MAX_CANCEL_MINUTES = 2880;

export type BookingRules = { bookingCancelWindowMinutes: number; waitlistEnabled: boolean; showMissedSessionCost: boolean };
export type CancelWindowError = "required" | "integer" | "range";

/** Validates the cancellation-window text. Returns the minutes or the reason it is not valid. */
export function parseCancelWindow(raw: unknown): { ok: true; value: number } | { ok: false; error: CancelWindowError } {
  const text = typeof raw === "string" ? raw.trim() : typeof raw === "number" ? String(raw) : "";
  if (text === "") return { ok: false, error: "required" };
  if (!/^-?\d+$/.test(text)) return { ok: false, error: "integer" };
  const n = Number(text);
  if (n < 0 || n > MAX_CANCEL_MINUTES) return { ok: false, error: "range" };
  return { ok: true, value: n };
}

export function validateRules(rules: { cancelWindow: string; waitlistEnabled: boolean; showMissedSessionCost: boolean }): { ok: true; value: BookingRules } | { ok: false; error: CancelWindowError } {
  const w = parseCancelWindow(rules.cancelWindow);
  if (!w.ok) return { ok: false, error: w.error };
  return { ok: true, value: { bookingCancelWindowMinutes: w.value, waitlistEnabled: rules.waitlistEnabled, showMissedSessionCost: rules.showMissedSessionCost } };
}

/** Minutes split into whole hours and remaining minutes, for the helper text. */
export function splitMinutes(total: number): { hours: number; minutes: number } {
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}
