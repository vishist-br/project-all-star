// Pure view-model helpers for the customer Progress and Profile screens (STAR-70).

/** `37.5` -> "37.5%"; null (no data in the range) -> null, so the screen can say "not enough data yet" rather than 0%. */
export function percentText(v: number | null): string | null {
  return v === null ? null : `${Number.isInteger(v) ? v : v.toFixed(1)}%`;
}

type Week = { weekStart: string; attended: number; missed: number; workoutsCompleted: number; workoutsScheduled: number };

/** Weekly attendance % per week; weeks with no marked sessions are null (a gap in the chart, never 0). */
export function weeklyAttendanceSeries(weeks: Week[]): (number | null)[] {
  return weeks.map((w) => (w.attended + w.missed === 0 ? null : Math.round((1000 * w.attended) / (w.attended + w.missed)) / 10));
}

/** Workouts per week; null when nothing was scheduled that week. */
export function weeklyWorkoutSeries(weeks: Week[]): { completed: (number | null)[]; scheduled: (number | null)[] } {
  return {
    completed: weeks.map((w) => (w.workoutsScheduled === 0 ? null : w.workoutsCompleted)),
    scheduled: weeks.map((w) => (w.workoutsScheduled === 0 ? null : w.workoutsScheduled)),
  };
}

/** True when a chart has at least one real point (otherwise show an empty state). */
export function hasData(values: (number | null)[]): boolean {
  return values.some((v) => v !== null);
}

export type GoalLike = {
  status: string;
  metric: string;
  progressPercent: number;
  currentValue: number | null;
  targetValue: number | null;
  unit: string | null;
};

/** "12 / 20 sessions", or null when the API has no current value yet. Numbers come straight from the API. */
export function goalValueText(g: GoalLike, fallbackUnit: string): string | null {
  if (g.currentValue === null) return null;
  const unit = g.unit ?? fallbackUnit;
  return g.targetValue === null ? `${g.currentValue} ${unit}` : `${g.currentValue} / ${g.targetValue} ${unit}`;
}

/** Active goals first, then achieved, then dropped; API order (newest first) kept inside each group. */
export function orderGoals<T extends { status: string }>(goals: T[]): T[] {
  const rank: Record<string, number> = { active: 0, achieved: 1, dropped: 2 };
  return goals
    .map((g, i) => ({ g, i }))
    .sort((a, b) => (rank[a.g.status] ?? 3) - (rank[b.g.status] ?? 3) || a.i - b.i)
    .map((x) => x.g);
}

export type FeeTone = "ok" | "warn" | "danger" | "neutral";

/** Fee status is display only: a plain badge, never anything about payment processing. */
export function feeBadge(status: "paid" | "due" | "overdue" | undefined): { tone: FeeTone; key: "paid" | "due" | "overdue" | "none" } {
  if (status === "paid") return { tone: "ok", key: "paid" };
  if (status === "due") return { tone: "warn", key: "due" };
  if (status === "overdue") return { tone: "danger", key: "overdue" };
  return { tone: "neutral", key: "none" };
}
