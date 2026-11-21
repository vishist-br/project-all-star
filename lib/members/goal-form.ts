/**
 * Goal editor logic: form state, validation mirroring lib/api/goals.ts and the payload the
 * server action sends. Pure and unit tested.
 */
export const GOAL_METRICS = ["sessions_attended", "workouts_completed", "level", "custom"] as const;
export type GoalMetric = (typeof GOAL_METRICS)[number];

export type GoalForm = {
  title: string;
  metric: GoalMetric;
  targetValue: string;
  startValue: string;
  unit: string;
  targetLevelId: string;
  targetDate: string;
};

export const emptyGoalForm = (): GoalForm => ({ title: "", metric: "sessions_attended", targetValue: "", startValue: "", unit: "", targetLevelId: "", targetDate: "" });

export type GoalError = { field: keyof GoalForm; code: "required" | "title" | "number" | "positive" | "unit" | "date" };

const num = (s: string): number | null => {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};

export function validateGoalForm(f: GoalForm, today: string): GoalError[] {
  const errs: GoalError[] = [];
  const title = f.title.trim();
  if (title.length < 1) errs.push({ field: "title", code: "required" });
  else if (title.length > 120) errs.push({ field: "title", code: "title" });
  if (f.metric === "level") {
    if (!f.targetLevelId) errs.push({ field: "targetLevelId", code: "required" });
  } else {
    const t = num(f.targetValue);
    if (t === null) errs.push({ field: "targetValue", code: "required" });
    else if (Number.isNaN(t) || Math.abs(t) > 99_999_999) errs.push({ field: "targetValue", code: "number" });
    else if (f.metric !== "custom" && t <= 0) errs.push({ field: "targetValue", code: "positive" });
    else if (f.metric === "custom" && t < 0) errs.push({ field: "targetValue", code: "positive" });
  }
  if (f.metric === "custom") {
    const s = num(f.startValue);
    if (s !== null && Number.isNaN(s)) errs.push({ field: "startValue", code: "number" });
  }
  if (f.unit.length > 20) errs.push({ field: "unit", code: "unit" });
  if (f.targetDate && (!/^\d{4}-\d{2}-\d{2}$/.test(f.targetDate) || f.targetDate < today)) errs.push({ field: "targetDate", code: "date" });
  return errs;
}

/** JSON body for createGoal; call only after validateGoalForm returned no errors. */
export function goalPayload(f: GoalForm): Record<string, unknown> {
  const body: Record<string, unknown> = { title: f.title.trim(), metric: f.metric };
  if (f.metric === "level") body.targetLevelId = f.targetLevelId;
  else body.targetValue = Number(f.targetValue);
  if (f.metric === "custom") {
    const s = num(f.startValue);
    if (s !== null) body.startValue = s;
  }
  if (f.unit.trim() && f.metric !== "level") body.unit = f.unit.trim();
  if (f.targetDate) body.targetDate = f.targetDate;
  return body;
}

export type CheckInForm = { value: string; note: string };
export type CheckInError = { field: keyof CheckInForm; code: "required" | "number" | "note" };

export function validateCheckIn(f: CheckInForm): CheckInError[] {
  const errs: CheckInError[] = [];
  const v = num(f.value);
  if (v === null) errs.push({ field: "value", code: "required" });
  else if (Number.isNaN(v) || Math.abs(v) > 99_999_999) errs.push({ field: "value", code: "number" });
  if (f.note.length > 280) errs.push({ field: "note", code: "note" });
  return errs;
}

export function checkInPayload(f: CheckInForm): Record<string, unknown> {
  return { value: Number(f.value), ...(f.note.trim() ? { note: f.note.trim() } : {}) };
}
