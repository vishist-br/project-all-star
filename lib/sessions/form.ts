import { isDateString, toInstant } from "./week";

/** Mirrors the API rules of createSession / updateSession so most problems show before sending. */
export type ScheduleMode = "batch" | "member";
export type ScheduleInput = {
  mode: ScheduleMode;
  batchId: string;
  memberId: string;
  date: string;
  startTime: string;
  endTime: string;
  capacity: string;
  title: string;
};
export type ScheduleField = "batchId" | "memberId" | "date" | "startTime" | "endTime" | "capacity" | "title";
export type ScheduleError = { field: ScheduleField; code: "required" | "timeFormat" | "endAfterStart" | "tooLong" | "capacityRange" | "titleLong" | "dateFormat" };

export const MAX_SESSION_MS = 12 * 3_600_000;
const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export function validateWindow(date: string, startTime: string, endTime: string): ScheduleError[] {
  const errors: ScheduleError[] = [];
  if (!date) errors.push({ field: "date", code: "required" });
  else if (!isDateString(date)) errors.push({ field: "date", code: "dateFormat" });
  if (!startTime) errors.push({ field: "startTime", code: "required" });
  else if (!TIME.test(startTime)) errors.push({ field: "startTime", code: "timeFormat" });
  if (!endTime) errors.push({ field: "endTime", code: "required" });
  else if (!TIME.test(endTime)) errors.push({ field: "endTime", code: "timeFormat" });
  if (errors.length === 0) {
    const ms = Date.parse(toInstant(date, endTime)) - Date.parse(toInstant(date, startTime));
    if (ms <= 0) errors.push({ field: "endTime", code: "endAfterStart" });
    else if (ms > MAX_SESSION_MS) errors.push({ field: "endTime", code: "tooLong" });
  }
  return errors;
}

export function validateSchedule(input: ScheduleInput): ScheduleError[] {
  const errors: ScheduleError[] = [];
  if (input.mode === "batch" && !input.batchId) errors.push({ field: "batchId", code: "required" });
  if (input.mode === "member" && !input.memberId) errors.push({ field: "memberId", code: "required" });
  errors.push(...validateWindow(input.date, input.startTime, input.endTime));
  if (input.mode === "batch" && input.capacity.trim() !== "") {
    const n = Number(input.capacity);
    if (!Number.isInteger(n) || n < 1 || n > 500) errors.push({ field: "capacity", code: "capacityRange" });
  }
  if (input.title.trim().length > 80) errors.push({ field: "title", code: "titleLong" });
  return errors;
}

/** Body for POST /sessions. `clientId` makes a double tap on Save create only one session. */
export function buildCreatePayload(input: ScheduleInput, clientId: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    ...(input.mode === "batch" ? { batchId: input.batchId } : { memberId: input.memberId }),
    startsAt: toInstant(input.date, input.startTime),
    endsAt: toInstant(input.date, input.endTime),
    clientId,
  };
  if (input.mode === "batch" && input.capacity.trim() !== "") body.capacity = Number(input.capacity);
  if (input.title.trim()) body.title = input.title.trim();
  return body;
}

/** Body for PATCH /sessions/{id} when moving a session. */
export function buildReschedulePayload(date: string, startTime: string, endTime: string) {
  return { startsAt: toInstant(date, startTime), endsAt: toInstant(date, endTime) };
}

export function buildCancelPayload(reason: string) {
  const r = reason.trim().slice(0, 200);
  return { status: "cancelled", ...(r ? { cancelReason: r } : {}) };
}
