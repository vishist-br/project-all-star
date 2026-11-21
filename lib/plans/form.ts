/**
 * Pure plan-builder logic (no React, no network): form state, validation that mirrors the
 * contract limits (docs/api/openapi.yaml WorkoutPlanInput) and payload building.
 */
export const CADENCES = ["daily", "weekly", "monthly"] as const;
export type Cadence = (typeof CADENCES)[number];

export const MAX_DAY: Record<Cadence, number> = { daily: 1, weekly: 7, monthly: 31 };
export const LIMITS = {
  title: 80,
  description: 1000,
  dayTitle: 80,
  dayNotes: 500,
  itemNotes: 280,
  itemsPerDay: 30,
  sets: [1, 20],
  reps: [1, 200],
  durationSeconds: [1, 7200],
  restSeconds: [0, 900],
} as const;

export type ItemForm = {
  key: string;
  /** Present for items that already exist on the server, so an update keeps them (and their logs). */
  id?: string;
  exerciseId: string;
  exerciseName: string;
  sets: string;
  reps: string;
  durationSeconds: string;
  restSeconds: string;
  notes: string;
};
export type DayForm = { key: string; dayIndex: number; title: string; notes: string; items: ItemForm[] };
export type PlanForm = { title: string; description: string; cadence: Cadence; sportSlug: string; days: DayForm[] };

/** Shape of a plan as returned by the API (only what the builder needs). */
export type PlanLike = {
  title: string;
  description: string | null;
  cadence: string;
  sportSlug: string | null;
  days: {
    dayIndex: number;
    title: string | null;
    notes: string | null;
    items: {
      id?: string;
      exerciseId: string;
      exerciseName: string;
      sets: number | null;
      reps: number | null;
      durationSeconds: number | null;
      restSeconds: number | null;
      notes: string | null;
    }[];
  }[];
};

let counter = 0;
export function newKey(): string {
  counter += 1;
  return `k${counter}`;
}

const str = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));

export function emptyDay(dayIndex: number): DayForm {
  return { key: newKey(), dayIndex, title: "", notes: "", items: [] };
}

export function emptyForm(): PlanForm {
  return { title: "", description: "", cadence: "weekly", sportSlug: "", days: [emptyDay(1)] };
}

export function emptyItem(exercise: { id: string; name: string }): ItemForm {
  return {
    key: newKey(),
    exerciseId: exercise.id,
    exerciseName: exercise.name,
    sets: "3",
    reps: "10",
    durationSeconds: "",
    restSeconds: "60",
    notes: "",
  };
}

export function formFromPlan(plan: PlanLike): PlanForm {
  const cadence = (CADENCES as readonly string[]).includes(plan.cadence) ? (plan.cadence as Cadence) : "weekly";
  return {
    title: plan.title,
    description: plan.description ?? "",
    cadence,
    sportSlug: plan.sportSlug ?? "",
    days: [...plan.days]
      .sort((a, b) => a.dayIndex - b.dayIndex)
      .map((d) => ({
        key: newKey(),
        dayIndex: d.dayIndex,
        title: d.title ?? "",
        notes: d.notes ?? "",
        items: d.items.map((i) => ({
          key: newKey(),
          ...(i.id ? { id: i.id } : {}),
          exerciseId: i.exerciseId,
          exerciseName: i.exerciseName,
          sets: str(i.sets),
          reps: str(i.reps),
          durationSeconds: str(i.durationSeconds),
          restSeconds: str(i.restSeconds),
          notes: i.notes ?? "",
        })),
      })),
  };
}

// ---- editing helpers (all return new objects) ----

/** Day indexes still free for the cadence, ascending. */
export function freeDayIndexes(form: PlanForm): number[] {
  const used = new Set(form.days.map((d) => d.dayIndex));
  const out: number[] = [];
  for (let i = 1; i <= MAX_DAY[form.cadence]; i += 1) if (!used.has(i)) out.push(i);
  return out;
}

export function addDay(form: PlanForm, dayIndex?: number): PlanForm {
  const free = freeDayIndexes(form);
  const idx = dayIndex ?? free[0];
  if (idx === undefined || !free.includes(idx)) return form;
  return { ...form, days: [...form.days, emptyDay(idx)].sort((a, b) => a.dayIndex - b.dayIndex) };
}

export function removeDay(form: PlanForm, key: string): PlanForm {
  return { ...form, days: form.days.filter((d) => d.key !== key) };
}

/** Changing the cadence keeps days that still fit; a daily plan keeps one day, renumbered to 1. */
export function changeCadence(form: PlanForm, cadence: Cadence): PlanForm {
  if (cadence === form.cadence) return form;
  let days = form.days;
  if (cadence === "daily") {
    const first = days[0] ?? emptyDay(1);
    days = [{ ...first, dayIndex: 1 }];
  } else {
    days = days.filter((d) => d.dayIndex <= MAX_DAY[cadence]);
    if (days.length === 0) days = [emptyDay(1)];
  }
  return { ...form, cadence, days };
}

export function setDayIndex(form: PlanForm, key: string, dayIndex: number): PlanForm {
  if (form.days.some((d) => d.key !== key && d.dayIndex === dayIndex)) return form;
  return { ...form, days: form.days.map((d) => (d.key === key ? { ...d, dayIndex } : d)).sort((a, b) => a.dayIndex - b.dayIndex) };
}

export function updateDay(form: PlanForm, key: string, fn: (d: DayForm) => DayForm): PlanForm {
  return { ...form, days: form.days.map((d) => (d.key === key ? fn(d) : d)) };
}

export function moveItem<T>(items: T[], from: number, direction: -1 | 1): T[] {
  const to = from + direction;
  if (from < 0 || from >= items.length || to < 0 || to >= items.length) return items;
  const copy = items.slice();
  [copy[from], copy[to]] = [copy[to], copy[from]];
  return copy;
}

// ---- validation ----

export type FormErrorCode = "required" | "tooLong" | "range" | "measure" | "noExercises" | "tooManyItems";
export type FormError = { path: string; code: FormErrorCode; params?: { max?: number; min?: number } };

function checkInt(errors: FormError[], path: string, raw: string, [min, max]: readonly [number, number]) {
  const v = raw.trim();
  if (v === "") return;
  const n = Number(v);
  if (!/^\d+$/.test(v) || !Number.isInteger(n) || n < min || n > max) errors.push({ path, code: "range", params: { min, max } });
}

/**
 * Same limits as the API. `status` "active" additionally needs at least one exercise: an active
 * plan with nothing in it cannot be worked through by a member. Drafts may be empty.
 */
export function validateForm(form: PlanForm, status: "draft" | "active"): FormError[] {
  const errors: FormError[] = [];
  const title = form.title.trim();
  if (title.length < 1) errors.push({ path: "title", code: "required" });
  else if (title.length > LIMITS.title) errors.push({ path: "title", code: "tooLong", params: { max: LIMITS.title } });
  if (form.description.length > LIMITS.description) errors.push({ path: "description", code: "tooLong", params: { max: LIMITS.description } });

  if (form.days.length < 1) errors.push({ path: "days", code: "required" });
  const maxDay = MAX_DAY[form.cadence];
  form.days.forEach((d, i) => {
    const p = `days[${i}]`;
    if (!Number.isInteger(d.dayIndex) || d.dayIndex < 1 || d.dayIndex > maxDay) errors.push({ path: `${p}.dayIndex`, code: "range", params: { min: 1, max: maxDay } });
    if (d.title.length > LIMITS.dayTitle) errors.push({ path: `${p}.title`, code: "tooLong", params: { max: LIMITS.dayTitle } });
    if (d.notes.length > LIMITS.dayNotes) errors.push({ path: `${p}.notes`, code: "tooLong", params: { max: LIMITS.dayNotes } });
    if (d.items.length > LIMITS.itemsPerDay) errors.push({ path: `${p}.items`, code: "tooManyItems", params: { max: LIMITS.itemsPerDay } });
    d.items.forEach((it, j) => {
      const ip = `${p}.items[${j}]`;
      checkInt(errors, `${ip}.sets`, it.sets, LIMITS.sets);
      checkInt(errors, `${ip}.reps`, it.reps, LIMITS.reps);
      checkInt(errors, `${ip}.durationSeconds`, it.durationSeconds, LIMITS.durationSeconds);
      checkInt(errors, `${ip}.restSeconds`, it.restSeconds, LIMITS.restSeconds);
      if (it.reps.trim() === "" && it.durationSeconds.trim() === "") errors.push({ path: ip, code: "measure" });
      if (it.notes.length > LIMITS.itemNotes) errors.push({ path: `${ip}.notes`, code: "tooLong", params: { max: LIMITS.itemNotes } });
    });
  });
  if (status === "active" && form.days.every((d) => d.items.length === 0)) errors.push({ path: "days", code: "noExercises" });
  return errors;
}

export function errorFor(errors: FormError[], path: string): FormError | undefined {
  return errors.find((e) => e.path === path);
}

// ---- payload ----

const num = (s: string): number | null => (s.trim() === "" ? null : Number(s));
const text = (s: string): string | null => (s.trim() === "" ? null : s.trim());

export type PlanPayload = {
  title: string;
  description: string | null;
  cadence: Cadence;
  sportSlug: string | null;
  status: "draft" | "active";
  days: {
    dayIndex: number;
    title: string | null;
    notes: string | null;
    items: {
      id?: string;
      exerciseId: string;
      position: number;
      sets: number | null;
      reps: number | null;
      durationSeconds: number | null;
      restSeconds: number | null;
      notes: string | null;
    }[];
  }[];
  expectedVersion?: number;
};

/** Request body for createWorkoutPlan, or updateWorkoutPlan when `expectedVersion` is given. Positions are renumbered 1..n. */
export function buildPayload(form: PlanForm, status: "draft" | "active", expectedVersion?: number): PlanPayload {
  return {
    title: form.title.trim(),
    description: text(form.description),
    cadence: form.cadence,
    sportSlug: form.sportSlug.trim() === "" ? null : form.sportSlug.trim(),
    status,
    days: [...form.days]
      .sort((a, b) => a.dayIndex - b.dayIndex)
      .map((d) => ({
        dayIndex: d.dayIndex,
        title: text(d.title),
        notes: text(d.notes),
        items: d.items.map((it, i) => ({
          ...(it.id ? { id: it.id } : {}),
          exerciseId: it.exerciseId,
          position: i + 1,
          sets: num(it.sets),
          reps: num(it.reps),
          durationSeconds: num(it.durationSeconds),
          restSeconds: num(it.restSeconds),
          notes: text(it.notes),
        })),
      })),
    ...(expectedVersion !== undefined ? { expectedVersion } : {}),
  };
}

// ---- assign ----

export type AssignInput = { memberIds: string[]; startsOn: string; endsOn: string; note: string };
export type AssignError = { field: "memberIds" | "startsOn" | "endsOn" | "note"; code: "required" | "dateOrder" | "tooLong" };

export function validateAssign(input: AssignInput): AssignError[] {
  const errors: AssignError[] = [];
  if (input.memberIds.length < 1) errors.push({ field: "memberIds", code: "required" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startsOn)) errors.push({ field: "startsOn", code: "required" });
  if (input.endsOn && input.startsOn && input.endsOn < input.startsOn) errors.push({ field: "endsOn", code: "dateOrder" });
  if (input.note.length > 280) errors.push({ field: "note", code: "tooLong" });
  return errors;
}

/** Today's date (YYYY-MM-DD) in the POC tenant time zone (IST), for the default start date. */
export function todayInTenantZone(now: Date = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}
