/**
 * Owner class insights: pure rules over per-slot numbers. Positive framing, visibility only: a slot is
 * "quiet" (room to grow), never "failing", and nothing here names or ranks a coach.
 */
export type SlotStats = {
  batchId: string;
  batchName: string;
  sportId: string;
  sessionCount: number;
  avgFillRate: number | null; // percent 0..100
  waitlistCount: number;
};

export type SessionFact = { status: string; capacity: number | null; present: number; absent: number; hasWorkout: boolean };

export const QUIET_FILL_BELOW = 40;
export const QUIET_MIN_SESSIONS = 3;
export const ADD_CLASS_MIN_WAITLIST = 3;
export const MOVE_TARGET_MIN_WAITLIST = 2;
export const MAX_SUGGESTIONS = 5;

export type Suggestion = {
  kind: "add_class" | "move_slot";
  messageKey: "ci.addClass" | "ci.moveSlot";
  batchId: string;
  params: Record<string, string | number>;
};

const pct1 = (n: number) => Math.round(n * 10) / 10;
const ratio = (a: number, b: number) => (b === 0 ? null : pct1((100 * a) / b));

/** Fill, attendance and workout share over the held (completed) sessions of one slot. */
export function slotRates(sessions: SessionFact[]) {
  const held = sessions.filter((s) => s.status === "COMPLETED");
  const filled = held.filter((s) => s.capacity !== null && s.capacity > 0);
  const present = held.reduce((n, s) => n + s.present, 0);
  const absent = held.reduce((n, s) => n + s.absent, 0);
  return {
    sessionCount: held.length,
    avgFillRate: filled.length === 0 ? null : pct1((100 * filled.reduce((n, s) => n + Math.min(1, s.present / s.capacity!), 0)) / filled.length),
    attendanceRate: ratio(present, present + absent),
    workoutSentShare: ratio(held.filter((s) => s.hasWorkout).length, held.length),
  };
}

/** Quiet = room to grow: enough classes held, low fill and nobody waiting for a place. */
export const isQuietSlot = (s: Pick<SlotStats, "sessionCount" | "avgFillRate"> & { waitlistCount?: number }) =>
  s.sessionCount >= QUIET_MIN_SESSIONS && s.avgFillRate !== null && s.avgFillRate < QUIET_FILL_BELOW && (s.waitlistCount ?? 0) === 0;

/** Plain-language suggestions from waitlist demand and fill. Longest waitlist first, at most 5. */
export function suggest(slots: SlotStats[]): Suggestion[] {
  const out: { s: Suggestion; weight: number; name: string }[] = [];
  for (const s of slots) {
    if (s.waitlistCount >= ADD_CLASS_MIN_WAITLIST) {
      out.push({
        s: { kind: "add_class", messageKey: "ci.addClass", batchId: s.batchId, params: { batchName: s.batchName, waitlistCount: s.waitlistCount } },
        weight: s.waitlistCount,
        name: s.batchName,
      });
    } else if (isQuietSlot(s)) {
      const target = slots
        .filter((t) => t.batchId !== s.batchId && t.sportId === s.sportId && t.waitlistCount >= MOVE_TARGET_MIN_WAITLIST)
        .sort((a, b) => b.waitlistCount - a.waitlistCount || a.batchName.localeCompare(b.batchName))[0];
      if (target) {
        out.push({
          s: {
            kind: "move_slot",
            messageKey: "ci.moveSlot",
            batchId: s.batchId,
            params: { batchName: s.batchName, targetBatchName: target.batchName, waitlistCount: target.waitlistCount },
          },
          weight: target.waitlistCount - 0.5,
          name: s.batchName,
        });
      }
    }
  }
  return out
    .sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name))
    .slice(0, MAX_SUGGESTIONS)
    .map((x) => x.s);
}
