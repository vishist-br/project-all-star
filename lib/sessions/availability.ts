/** Weekly availability rules, matching replaceCoachAvailability (weekday 1..7, HH:mm, end after start, no overlap on a day, max 50). */
export type SlotDraft = { key: string; weekday: number; startTime: string; endTime: string; venueId: string | null };
export type SlotError = { index: number; field: "startTime" | "endTime"; code: "required" | "timeFormat" | "endAfterStart" | "overlap"; other?: number };

export const MAX_SLOTS = 50;
const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export function validateSlots(slots: readonly SlotDraft[]): { errors: SlotError[]; tooMany: boolean } {
  const errors: SlotError[] = [];
  slots.forEach((s, index) => {
    if (!s.startTime) errors.push({ index, field: "startTime", code: "required" });
    else if (!TIME.test(s.startTime)) errors.push({ index, field: "startTime", code: "timeFormat" });
    if (!s.endTime) errors.push({ index, field: "endTime", code: "required" });
    else if (!TIME.test(s.endTime)) errors.push({ index, field: "endTime", code: "timeFormat" });
    if (TIME.test(s.startTime) && TIME.test(s.endTime) && s.startTime >= s.endTime) errors.push({ index, field: "endTime", code: "endAfterStart" });
  });
  const valid = (i: number) => !errors.some((e) => e.index === i);
  slots.forEach((a, i) => {
    slots.forEach((b, j) => {
      // Touching ranges (09:00 end, 09:00 start) are fine; overlapping ones are not.
      if (j > i && valid(i) && valid(j) && a.weekday === b.weekday && a.startTime < b.endTime && b.startTime < a.endTime) {
        errors.push({ index: j, field: "startTime", code: "overlap", other: i });
      }
    });
  });
  return { errors, tooMany: slots.length > MAX_SLOTS };
}

export function toPayload(slots: readonly SlotDraft[]) {
  return {
    slots: [...slots]
      .sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime))
      .map((s) => ({ weekday: s.weekday, startTime: s.startTime, endTime: s.endTime, venueId: s.venueId })),
  };
}

let counter = 0;
export function newSlot(weekday: number, startTime = "09:00", endTime = "10:00", venueId: string | null = null): SlotDraft {
  counter += 1;
  return { key: `slot-${Date.now().toString(36)}-${counter}`, weekday, startTime, endTime, venueId };
}

export function fromApi(slots: readonly { weekday: number; startTime: string; endTime: string; venueId: string | null }[]): SlotDraft[] {
  return slots.map((s) => newSlot(s.weekday, s.startTime, s.endTime, s.venueId));
}

/** Compact signature to tell whether the editor has unsaved changes. */
export function signature(slots: readonly SlotDraft[]): string {
  return JSON.stringify(toPayload(slots));
}
