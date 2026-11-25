/** Result of a server action: plain data that is safe to send to the browser (no tokens, no Prisma objects). */
export type ActionError = {
  ok: false;
  code: "validation_failed" | "unauthorized" | "forbidden" | "not_found" | "conflict" | "rate_limited" | "payload_too_large" | "internal_error";
  message: string;
  details?: { field: string; message: string }[];
};
export type ActionResult<T> = { ok: true; data: T } | ActionError;

export type ExerciseSummary = {
  id: string;
  name: string;
  sportSlug: string | null;
  equipment: string | null;
  primaryMuscles: string[];
  needsTrainerReview: boolean;
  /** How the exercise is logged: WEIGHT_REPS, REPS, TIME, DISTANCE_TIME, SCORE or CHECKLIST. */
  metricType: "WEIGHT_REPS" | "REPS" | "TIME" | "DISTANCE_TIME" | "SCORE" | "CHECKLIST";
};
export type ExerciseDetail = ExerciseSummary & { category: string | null; level: string | null; secondaryMuscles: string[]; instructions: string[]; licence: string };
export type ExercisePage = { items: ExerciseSummary[]; nextCursor: string | null };
export type MemberOption = { id: string; name: string; level: string | null };
export type AssignOutcome = { memberId: string; name: string; ok: boolean; code?: ActionError["code"]; message?: string };
export type PlanSaved = { id: string; version: number; status: string };
