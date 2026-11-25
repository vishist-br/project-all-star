import type { TenantClient } from "../tenant-scope";
import { isQuietSlot, slotRates, suggest, type SessionFact } from "../analytics/class-insights";
import { ApiError } from "../auth/errors";
import { tenantDate } from "./pagination";
import { addDays, startOfDay } from "./schedule";

export const INSIGHT_RANGES = { "7d": 7, "28d": 28, "90d": 90 } as const;
export type InsightRange = keyof typeof INSIGHT_RANGES;

/**
 * GET /analytics/classes (getClassInsights). Owner only. Per group-class slot over the last N days:
 * fill rate, attendance rate, waitlist, quiet-slot flag and the share of classes with a workout, plus
 * plain suggestions. No coach is named or ranked.
 */
export async function getClassInsights(db: TenantClient, params: URLSearchParams, now = new Date()) {
  const raw = params.get("range") || "28d";
  if (!(raw in INSIGHT_RANGES)) {
    throw new ApiError("validation_failed", "range must be one of 7d, 28d, 90d", [{ field: "range", message: "One of 7d, 28d, 90d" }]);
  }
  const range = raw as InsightRange;
  const today = tenantDate(now);
  const from = addDays(today, -(INSIGHT_RANGES[range] - 1));

  const [batches, sessions, waitlisted] = await Promise.all([
    db.batch.findMany({
      where: { kind: "GROUP_CLASS", isActive: true },
      orderBy: [{ startTime: "asc" }, { name: "asc" }, { id: "asc" }],
      select: { id: true, name: true, sportId: true, capacity: true, daysOfWeek: true, startTime: true, endTime: true, sport: { select: { name: true } } },
    }),
    db.session.findMany({
      where: { startsAt: { gte: startOfDay(from), lt: now }, status: { not: "CANCELLED" } },
      select: { id: true, batchId: true, status: true, capacity: true, planDayId: true },
    }),
    db.sessionBooking.findMany({
      where: { status: "WAITLISTED", session: { startsAt: { gte: startOfDay(from) }, status: "SCHEDULED" } },
      select: { session: { select: { batchId: true } } },
    }),
  ]);
  const groups = sessions.length
    ? await db.attendance.groupBy({ by: ["sessionId", "status"], where: { sessionId: { in: sessions.map((s) => s.id) } }, _count: { _all: true } })
    : [];
  const counts = new Map<string, { present: number; absent: number }>();
  for (const g of groups) {
    const c = counts.get(g.sessionId) ?? { present: 0, absent: 0 };
    if (g.status === "PRESENT") c.present += g._count._all;
    else if (g.status === "ABSENT") c.absent += g._count._all;
    counts.set(g.sessionId, c);
  }
  const waitBy = new Map<string, number>();
  for (const w of waitlisted) waitBy.set(w.session.batchId, (waitBy.get(w.session.batchId) ?? 0) + 1);

  const facts = new Map<string, SessionFact[]>();
  const all: SessionFact[] = [];
  for (const s of sessions) {
    const batch = batches.find((b) => b.id === s.batchId);
    if (!batch) continue; // one-on-one or inactive batches are not class slots
    const c = counts.get(s.id) ?? { present: 0, absent: 0 };
    const f: SessionFact = { status: s.status, capacity: s.capacity ?? batch.capacity, present: c.present, absent: c.absent, hasWorkout: s.planDayId !== null };
    facts.set(s.batchId, [...(facts.get(s.batchId) ?? []), f]);
    all.push(f);
  }

  const slots = batches.map((b) => {
    const rates = slotRates(facts.get(b.id) ?? []);
    const waitlistCount = waitBy.get(b.id) ?? 0;
    return {
      batchId: b.id,
      batchName: b.name,
      sportId: b.sportId,
      sportName: b.sport.name,
      daysOfWeek: b.daysOfWeek,
      startTime: b.startTime,
      endTime: b.endTime,
      capacity: b.capacity,
      ...rates,
      waitlistCount,
      quietSlot: isQuietSlot({ ...rates, waitlistCount }),
    };
  });
  const overall = slotRates(all);
  return {
    range,
    from,
    to: today,
    overall: { classesHeld: overall.sessionCount, avgFillRate: overall.avgFillRate, attendanceRate: overall.attendanceRate, workoutSentShare: overall.workoutSentShare },
    slots,
    suggestions: suggest(slots),
  };
}
