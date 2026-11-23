/**
 * Pre-declared excused absences (STAR-95): pure rules, no database.
 *
 * A member or parent tells the coach ahead of time that a session or a date range will be missed,
 * with a reason. On the coach's roll call that member shows as EXCUSED before anyone taps. The
 * timeline rule is unchanged (`extendsTimeline` in lib/api/attendance.ts): only a plain ABSENT
 * extends a member's timeline, so a declared absence never does.
 */

export const ABSENCE_REASONS = ["exam", "illness", "festival", "travel"] as const;
export type AbsenceReason = (typeof ABSENCE_REASONS)[number];

/** Longest range one declaration may span, in days (inclusive). Longer breaks are several declarations. */
export const MAX_RANGE_DAYS = 60;
export const MAX_NOTE_LENGTH = 280;

export type Declaration = {
  id: string;
  fromDate: string;
  toDate: string;
  /** Set when the declaration is for one session only. */
  sessionId: string | null;
  reason: AbsenceReason;
  note: string | null;
  /** True once withdrawn. */
  withdrawn: boolean;
};

/** Does this declaration cover the session? Withdrawn ones never do. */
export function covers(
  d: Pick<Declaration, "fromDate" | "toDate" | "sessionId" | "withdrawn">,
  session: { id: string; date: string },
): boolean {
  if (d.withdrawn) return false;
  if (d.sessionId !== null) return d.sessionId === session.id;
  return d.fromDate <= session.date && session.date <= d.toDate;
}

/** The declaration to show for a session: a session-specific one wins over a date range; the lowest id breaks ties. */
export function pickDeclaration<T extends Declaration>(list: readonly T[], session: { id: string; date: string }): T | null {
  const hits = list.filter((d) => covers(d, session));
  if (hits.length === 0) return null;
  return [...hits].sort((a, b) => Number(b.sessionId !== null) - Number(a.sessionId !== null) || a.id.localeCompare(b.id))[0];
}

/** Inclusive number of calendar days between two `YYYY-MM-DD` dates. */
export function daysInRange(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/** Client id of the attendance row a declaration produces when the roll call is completed. Unique per declaration and session. */
export function preMarkClientId(declarationId: string, sessionId: string): string {
  return `pre-${declarationId}-${sessionId}`.slice(0, 64);
}
