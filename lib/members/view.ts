/**
 * Pure view-model logic for the coach roster, member detail and My record screens (no React,
 * no database). Percentages arrive as `number | null`; null means "not enough data yet" and is
 * never shown as 0.
 */

export type StatsLike = {
  attendance: { attended: number; missed: number; excused: number; percent: number | null };
  workouts: { scheduled: number; completed: number; adherencePercent: number | null };
};

export type CheckInReason = "attendance" | "adherence" | "inactive";

/** A friendly check-in is suggested (never a penalty) when the last 30 days show a dip. */
export const CHECK_IN = { minMarked: 3, attendanceBelow: 50, minScheduled: 5, adherenceBelow: 30 } as const;

/** Reasons a coach might want to check in with a member. Empty list means nothing to flag. */
export function checkInReasons(stats: StatsLike | null): CheckInReason[] {
  if (!stats) return [];
  const out: CheckInReason[] = [];
  const marked = stats.attendance.attended + stats.attendance.missed;
  if (stats.attendance.percent !== null && marked >= CHECK_IN.minMarked && stats.attendance.percent < CHECK_IN.attendanceBelow) {
    out.push("attendance");
  }
  if (stats.workouts.adherencePercent !== null && stats.workouts.scheduled >= CHECK_IN.minScheduled && stats.workouts.adherencePercent < CHECK_IN.adherenceBelow) {
    out.push("adherence");
  }
  return out;
}

export const needsCheckIn = (stats: StatsLike | null) => checkInReasons(stats).length > 0;

/** Whole-number or one-decimal percent text; null becomes the caller's "not enough data" text. */
export function percentText(value: number | null, empty: string): string {
  if (value === null || Number.isNaN(value)) return empty;
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

export type RosterFilters = { q: string; batchId: string; status: "active" | "ended" | "all"; checkIn: boolean };

export function parseRosterFilters(sp: Record<string, string | string[] | undefined>): RosterFilters {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim().slice(0, 80) : "");
  const status = one("status");
  return {
    q: one("q"),
    batchId: one("batchId"),
    status: status === "ended" || status === "all" ? status : "active",
    checkIn: one("checkin") === "1",
  };
}

/** Query string for listMembers from the roster filters. */
export function memberQuery(f: RosterFilters, limit = 100): URLSearchParams {
  const p = new URLSearchParams({ limit: String(limit) });
  if (f.q) p.set("q", f.q);
  if (f.batchId) p.set("batchId", f.batchId);
  if (f.status !== "all") p.set("status", f.status);
  return p;
}

export type RosterRow = {
  id: string;
  name: string;
  status: "active" | "paused" | "ended";
  batchNames: string[];
  level: string | null;
  feeStatus: "paid" | "due" | "overdue" | null;
  attendancePercent: number | null;
  adherencePercent: number | null;
  activePlan: string | null;
  reasons: CheckInReason[];
};

export function buildRosterRow(
  m: { id: string; name: string; status: RosterRow["status"]; batchIds: string[]; level: string | null; feeStatus?: "paid" | "due" | "overdue" },
  stats: StatsLike | null,
  batchNames: Map<string, string>,
  planTitle: string | null,
): RosterRow {
  return {
    id: m.id,
    name: m.name,
    status: m.status,
    batchNames: m.batchIds.map((id) => batchNames.get(id)).filter((n): n is string => Boolean(n)),
    level: m.level,
    feeStatus: m.feeStatus ?? null,
    attendancePercent: stats?.attendance.percent ?? null,
    adherencePercent: stats?.workouts.adherencePercent ?? null,
    activePlan: planTitle,
    reasons: m.status === "active" ? checkInReasons(stats) : [],
  };
}

/** Flagged members first (they get a friendly check-in), then by name. */
export function sortRoster(rows: RosterRow[]): RosterRow[] {
  return [...rows].sort((a, b) => Number(b.reasons.length > 0) - Number(a.reasons.length > 0) || a.name.localeCompare(b.name));
}

/** Runs async work over items with a small concurrency limit (keeps the database calm on large rosters). */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export type WeeklyPoint = { weekStart: string; attended: number; missed: number; workoutsCompleted: number; workoutsScheduled: number };

/** Chart series from getMemberStats().weekly: adherence is null (a gap) for a week with nothing scheduled. */
export function weeklySeries(weekly: WeeklyPoint[], label: (isoDate: string) => string) {
  return {
    labels: weekly.map((w) => label(w.weekStart)),
    attended: weekly.map((w) => w.attended),
    missed: weekly.map((w) => w.missed),
    adherence: weekly.map((w) => (w.workoutsScheduled === 0 ? null : Math.round((1000 * w.workoutsCompleted) / w.workoutsScheduled) / 10)),
    hasAttendance: weekly.some((w) => w.attended + w.missed > 0),
    hasWorkouts: weekly.some((w) => w.workoutsScheduled > 0),
  };
}

export const PERIODS = [30, 90] as const;
export function parsePeriod(v: string | string[] | undefined): (typeof PERIODS)[number] {
  return v === "90" ? 90 : 30;
}

/** `from`/`to` dates (YYYY-MM-DD) for a period ending today (tenant date supplied by the caller). */
export function periodRange(today: string, days: number): { from: string; to: string } {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return { from: d.toISOString().slice(0, 10), to: today };
}

/** Short day label, for example "3 Nov". Dates are plain calendar dates, so format in UTC. */
export function shortDate(iso: string, locale: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString(locale === "en" ? "en-IN" : locale, { day: "numeric", month: "short", timeZone: "UTC" });
}
