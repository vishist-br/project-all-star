/**
 * Owner analytics formulas (docs/PLAN-POC.md section 4). Pure: no database, no clock. Dates are
 * `YYYY-MM-DD` strings in the tenant timezone. Percentages are `null`, never 0, when there is
 * nothing to measure.
 */
import { addDays, spanDays } from "../api/schedule";
import { pct, weekStartOf } from "../api/member-stats";
import { isoWeekday } from "../workouts/expand";

export { pct, weekStartOf, addDays, spanDays };

export const UNLOGGED_AFTER_MS = 2 * 3_600_000;

export const round1 = (n: number) => Math.round(n * 10) / 10;

// ---- members ----

export type MemberLife = { joinedOn: string; leftOn: string | null; isActive: boolean };

/**
 * Active on a date: joined on or before it and not left by then. For today or later the `isActive`
 * flag also has to be set; for past dates only `leftOn` counts (history is kept by dates).
 */
export function isActiveOn(m: MemberLife, date: string, today: string): boolean {
  if (m.joinedOn > date) return false;
  if (m.leftOn !== null && m.leftOn <= date) return false;
  if (date >= today && !m.isActive) return false;
  return true;
}

export const countActive = (ms: readonly MemberLife[], date: string, today: string) =>
  ms.reduce((n, m) => n + (isActiveOn(m, date, today) ? 1 : 0), 0);

export const countJoined = (ms: readonly MemberLife[], from: string, to: string) =>
  ms.reduce((n, m) => n + (m.joinedOn >= from && m.joinedOn <= to ? 1 : 0), 0);

export const countLeft = (ms: readonly MemberLife[], from: string, to: string) =>
  ms.reduce((n, m) => n + (m.leftOn !== null && m.leftOn >= from && m.leftOn <= to ? 1 : 0), 0);

/** netGrowthPercent = pct(active(to) - active(from - 1), active(from - 1)). */
export function netGrowthPercent(ms: readonly MemberLife[], from: string, to: string, today: string): number | null {
  const before = countActive(ms, addDays(from, -1), today);
  return pct(countActive(ms, to, today) - before, before);
}

/**
 * Customer retention rate over [from, to]: of the members active the day before `from`, the share
 * still active at `to`. (PLAN-POC writes it as pct(active(to) - new, active(from - 1)); this is the
 * same number, but members who joined and left inside the period cannot distort it.)
 */
export function retentionPercent(ms: readonly MemberLife[], from: string, to: string, today: string): number | null {
  const start = addDays(from, -1);
  let base = 0;
  let kept = 0;
  for (const m of ms) {
    if (!isActiveOn(m, start, today)) continue;
    base += 1;
    if (isActiveOn(m, to, today)) kept += 1;
  }
  return pct(kept, base);
}

export type Cohort = { month: string; joined: number; retained30: number | null; retained60: number | null; retained90: number | null };

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

/** Last `months` join months ending with the month of `today`, oldest first. */
export function joinCohorts(ms: readonly Pick<MemberLife, "joinedOn" | "leftOn">[], today: string, months = 6): Cohort[] {
  const current = today.slice(0, 7);
  const out: Cohort[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const month = shiftMonth(current, -i);
    const group = ms.filter((m) => m.joinedOn.slice(0, 7) === month);
    const retained = (n: number) => {
      let old = 0;
      let kept = 0;
      for (const m of group) {
        const mark = addDays(m.joinedOn, n);
        if (mark > today) continue;
        old += 1;
        if (m.leftOn === null || m.leftOn > mark) kept += 1;
      }
      return pct(kept, old);
    };
    out.push({ month, joined: group.length, retained30: retained(30), retained60: retained(60), retained90: retained(90) });
  }
  return out;
}

// ---- KPI value with previous period ----

export type Kpi = { value: number | null; previous: number | null; changePercent: number | null };

/** `changePercent = pct(value - previous, previous)`; null when either side is missing or previous is not positive. */
export function kpi(value: number | null, previous?: number | null): Kpi {
  const prev = previous ?? null;
  return { value, previous: prev, changePercent: value !== null && prev !== null && prev > 0 ? pct(value - prev, prev) : null };
}

/** The same-length period immediately before [from, to]. */
export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const len = spanDays(from, to);
  return { from: addDays(from, -len), to: addDays(from, -1) };
}

// ---- sessions and attendance ----

export type SessionFact = {
  id: string;
  date: string; // tenant calendar date of startsAt
  startsAt: Date;
  endsAt: Date;
  status: "SCHEDULED" | "COMPLETED" | "CANCELLED";
  coachId: string;
  batchId: string;
  capacity?: number | null;
};
export type AttTally = { present: number; absent: number; excused: number };
export type AttMap = ReadonlyMap<string, AttTally>;

export type SessionTally = {
  scheduled: number;
  completed: number;
  cancelled: number;
  unlogged: number;
  present: number;
  absent: number;
  excused: number;
};

/**
 * Sessions in a set: scheduled = past, not cancelled, not on a holiday; completed = of those, COMPLETED;
 * cancelled = status CANCELLED; unlogged = of scheduled, still SCHEDULED and ended more than 2 h ago.
 * Attendance counts only come from completed sessions. Excused absences never count as missed.
 */
export function tallySessions(sessions: readonly SessionFact[], att: AttMap, holidays: ReadonlySet<string>, now: Date): SessionTally {
  const t: SessionTally = { scheduled: 0, completed: 0, cancelled: 0, unlogged: 0, present: 0, absent: 0, excused: 0 };
  for (const s of sessions) {
    if (s.status === "CANCELLED") {
      t.cancelled += 1;
      continue;
    }
    if (holidays.has(s.date) || s.startsAt >= now) continue;
    t.scheduled += 1;
    if (s.status === "COMPLETED") {
      t.completed += 1;
      const a = att.get(s.id);
      if (a) {
        t.present += a.present;
        t.absent += a.absent;
        t.excused += a.excused;
      }
    } else if (s.endsAt.getTime() < now.getTime() - UNLOGGED_AFTER_MS) {
      t.unlogged += 1;
    }
  }
  return t;
}

export type Bucket = { sessions: number; present: number; absent: number };

/** Attendance of completed, past, non-holiday sessions grouped by a key (weekday, batch, ...). */
export function attendanceBy(
  sessions: readonly SessionFact[],
  att: AttMap,
  holidays: ReadonlySet<string>,
  now: Date,
  key: (s: SessionFact) => string,
): Map<string, Bucket> {
  const out = new Map<string, Bucket>();
  for (const s of sessions) {
    if (s.status !== "COMPLETED" || holidays.has(s.date) || s.startsAt >= now) continue;
    const k = key(s);
    const b = out.get(k) ?? { sessions: 0, present: 0, absent: 0 };
    const a = att.get(s.id);
    b.sessions += 1;
    b.present += a?.present ?? 0;
    b.absent += a?.absent ?? 0;
    out.set(k, b);
  }
  return out;
}

export const attendancePct = (t: { present: number; absent: number }) => pct(t.present, t.present + t.absent);
export const noShowPct = (t: { present: number; absent: number }) => pct(t.absent, t.present + t.absent);

export const weekdayOf = (date: string) => isoWeekday(date);

// ---- follow-ups ----

/** Number of leading ABSENT rows of a member's attendance, newest first (EXCUSED breaks the run). */
export function absenceRun(statusesNewestFirst: readonly string[]): number {
  let n = 0;
  for (const s of statusesNewestFirst) {
    if (s !== "ABSENT") break;
    n += 1;
  }
  return n;
}

export const FOLLOW_UP_ABSENCES = 3;
export const FOLLOW_UP_INACTIVE_DAYS = 14;
export const FOLLOW_UP_ADHERENCE_BELOW = 30;
export const FOLLOW_UP_MIN_ITEMS = 5;

/** workouts_pending: adherence strictly below 30% with at least 5 scheduled items. */
export function workoutsPending(scheduled: number, completed: number): number | null {
  if (scheduled < FOLLOW_UP_MIN_ITEMS) return null;
  const p = pct(completed, scheduled);
  return p !== null && p < FOLLOW_UP_ADHERENCE_BELOW ? p : null;
}

// ---- coach availability ----

/** Hours between two "HH:mm" times. */
export function slotHours(startTime: string, endTime: string): number {
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return Math.max(0, m(endTime) - m(startTime)) / 60;
}

/** loadPercent = pct(bookedHoursNext7d, availabilityHoursPerWeek), capped at 100 (the contract's Percent range). */
export function loadPercent(bookedHours: number, availabilityHours: number): number | null {
  const p = pct(bookedHours, availabilityHours);
  return p === null ? null : Math.min(100, p);
}

// ---- insight cards ----

export type CardInput = {
  attendancePercent: number | null;
  previousAttendancePercent: number | null;
  byWeekday: { weekday: number; percent: number | null; sessions: number }[];
  newMembers: number;
  coaches: { scheduled: number; completed: number }[];
  adherencePercent: number | null;
  membersWithPlan: number;
  followUpCount: number;
};
export type InsightCard = { code: string; tone: "positive" | "neutral" | "attention"; title: string; params: Record<string, string> };

export const CARD_MIN_WEEKDAY_SESSIONS = 3;
export const CARD_LOW_WEEKDAY_GAP = 15;
export const CARD_TREND_POINTS = 5;
export const CARD_COACH_MIN_SESSIONS = 4;
export const MAX_CARDS = 6;

/** The rule list of PLAN-POC 4.5, evaluated in order, at most 6, deterministic. Titles are i18n keys. */
export function buildCards(i: CardInput): InsightCard[] {
  const cards: InsightCard[] = [];
  const key = (code: string) => `insights.card.${code}`;
  const eligible = i.byWeekday.filter((w) => w.percent !== null && w.sessions >= CARD_MIN_WEEKDAY_SESSIONS);

  // 1. best weekday (highest %, earliest weekday on a tie)
  let best: (typeof eligible)[number] | undefined;
  for (const w of eligible) if (!best || w.percent! > best.percent!) best = w;
  if (best) cards.push({ code: "best_weekday", tone: "positive", title: key("best_weekday"), params: { weekday: String(best.weekday), percent: String(best.percent) } });

  // 2. lowest weekday when at least 15 points below the average
  let low: (typeof eligible)[number] | undefined;
  for (const w of eligible) if (!low || w.percent! < low.percent!) low = w;
  if (low && i.attendancePercent !== null && i.attendancePercent - low.percent! >= CARD_LOW_WEEKDAY_GAP) {
    cards.push({ code: "low_weekday", tone: "attention", title: key("low_weekday"), params: { weekday: String(low.weekday), percent: String(low.percent) } });
  }

  // 3. attendance trend in percentage points
  if (i.attendancePercent !== null && i.previousAttendancePercent !== null) {
    const change = round1(i.attendancePercent - i.previousAttendancePercent);
    if (Math.abs(change) >= CARD_TREND_POINTS) {
      cards.push({
        code: "attendance_trend",
        tone: change > 0 ? "positive" : "attention",
        title: key("attendance_trend"),
        params: { direction: change > 0 ? "up" : "down", points: String(Math.abs(change)), percent: String(i.attendancePercent) },
      });
    }
  }

  // 4. new members
  if (i.newMembers > 0) cards.push({ code: "new_members", tone: "positive", title: key("new_members"), params: { count: String(i.newMembers) } });

  // 5. coaches who delivered every scheduled session
  const steady = i.coaches.filter((c) => c.scheduled >= CARD_COACH_MIN_SESSIONS && c.completed === c.scheduled).length;
  if (steady > 0) cards.push({ code: "coach_consistency", tone: "positive", title: key("coach_consistency"), params: { count: String(steady) } });

  // 6. plan adherence
  if (i.adherencePercent !== null) {
    cards.push({
      code: "plan_adherence",
      tone: i.adherencePercent >= 70 ? "positive" : "neutral",
      title: key("plan_adherence"),
      params: { percent: String(i.adherencePercent), members: String(i.membersWithPlan) },
    });
  }

  // 7. members who may need a friendly check-in
  if (i.followUpCount > 0) cards.push({ code: "follow_ups", tone: "attention", title: key("follow_ups"), params: { count: String(i.followUpCount) } });

  return cards.slice(0, MAX_CARDS);
}
