import { assignmentWhere, managedMemberWhere } from "@/lib/auth/access";
import { listBatches } from "@/lib/api/batches";
import { listPlanAssignments } from "@/lib/api/assignments";
import { getCoachStats } from "@/lib/api/coaches";
import { listGoals } from "@/lib/api/goals";
import { getMember, listMembers } from "@/lib/api/members";
import { listMemberUpdates } from "@/lib/api/member-updates";
import { tenantDate } from "@/lib/api/pagination";
import { addDays, getMemberSchedule } from "@/lib/api/schedule";
import { getMemberStats } from "@/lib/api/member-stats";
import { listSessions } from "@/lib/api/sessions";
import { listWorkoutPlans } from "@/lib/api/workout-plans";
import type { Principal } from "@/lib/auth/principal";
import type { TenantClient } from "@/lib/tenant-scope";
import { buildRosterRow, mapLimit, memberQuery, periodRange, sortRoster, type RosterFilters, type RosterRow } from "./view";

/** Server-side loaders for the member screens. Everything goes through the same lib/api functions as the /api/v1 routes, with the viewer's principal. */

const page = (limit: number) => new URLSearchParams({ limit: String(limit) });

export async function loadRoster(db: TenantClient, p: Principal, filters: RosterFilters) {
  const today = tenantDate(new Date());
  const [members, batches] = await Promise.all([listMembers(db, p, memberQuery(filters)), listBatches(db, p, page(100))]);
  const ids = members.items.map((m) => m.id);
  const { from, to } = periodRange(today, 30);
  const range = new URLSearchParams({ from, to });

  const [stats, plans] = await Promise.all([
    mapLimit(ids, 8, (id) => getMemberStats(db, p, id, range).catch(() => null)),
    ids.length
      ? db.planAssignment.findMany({
          where: { AND: [assignmentWhere(p), { memberId: { in: ids }, status: "ACTIVE" }] },
          orderBy: [{ createdAt: "desc" }],
          select: { memberId: true, plan: { select: { title: true } } },
        })
      : Promise.resolve([]),
  ]);
  const batchNames = new Map(batches.items.map((b) => [b.id, b.name]));
  const planBy = new Map<string, string>();
  for (const a of plans) if (!planBy.has(a.memberId)) planBy.set(a.memberId, a.plan.title);

  let rows: RosterRow[] = members.items.map((m, i) => buildRosterRow(m, stats[i], batchNames, planBy.get(m.id) ?? null));
  if (filters.checkIn) rows = rows.filter((r) => r.reasons.length > 0);
  return {
    rows: sortRoster(rows),
    batches: batches.items.map((b) => ({ id: b.id, name: b.name })),
    more: members.nextCursor !== null,
    flagged: rows.filter((r) => r.reasons.length > 0).length,
  };
}

export async function loadMemberDetail(db: TenantClient, p: Principal, memberId: string, days: number) {
  const now = new Date();
  const today = tenantDate(now);
  const { from, to } = periodRange(today, days);
  const member = await getMember(db, p, memberId);
  const next7 = new URLSearchParams({ from: today, to: addDays(today, 6) });

  const [stats, goals, assignments, updates, schedule, managed, levels, plans] = await Promise.all([
    getMemberStats(db, p, memberId, new URLSearchParams({ from, to })),
    listGoals(db, p, memberId, new URLSearchParams()),
    listPlanAssignments(db, p, new URLSearchParams({ memberId, limit: "50" })),
    listMemberUpdates(db, p, memberId, page(6)),
    getMemberSchedule(db, p, memberId, next7),
    db.member.findFirst({ where: { id: memberId, ...managedMemberWhere(p) }, select: { id: true } }),
    member.sportId ? db.level.findMany({ where: { sportId: member.sportId }, orderBy: { rank: "asc" }, select: { id: true, name: true, rank: true } }) : Promise.resolve([]),
    p.role === "customer" ? Promise.resolve({ items: [] }) : listWorkoutPlans(db, p, new URLSearchParams({ status: "active", limit: "100" })),
  ]);
  return {
    member,
    stats,
    goals: goals.items,
    assignments: assignments.items,
    updates,
    schedule,
    canManage: managed !== null,
    levels,
    plans: plans.items.map((pl: { id: string; title: string }) => ({ id: pl.id, title: pl.title })),
    today,
  };
}

export async function loadCoachRecord(db: TenantClient, p: Principal, coachId: string, days: number) {
  const now = new Date();
  const today = tenantDate(now);
  const { from, to } = periodRange(today, days);
  const stats = await getCoachStats(db, p, coachId, new URLSearchParams({ from, to }), now);
  const recent = await listSessions(db, p, new URLSearchParams({ status: "completed", coachId, from, to, limit: "10" }));
  return { stats, recent: recent.items, from, to };
}
