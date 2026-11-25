import { memberWhere } from "../auth/access";
import type { Principal } from "../auth/principal";
import type { TenantClient } from "../tenant-scope";

/** Members the viewer may see who have logged sets for an exercise (coach: own members, owner: all). */
export async function membersWhoLogged(db: TenantClient, p: Principal, exerciseId: string): Promise<{ id: string; name: string }[]> {
  const logs = await db.workoutLog.findMany({
    where: { sets: { some: {} }, planItem: { exerciseId }, member: memberWhere(p) },
    select: { member: { select: { id: true, displayName: true } } },
    take: 400,
  });
  const seen = new Map<string, string>();
  for (const l of logs) seen.set(l.member.id, l.member.displayName);
  return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** Superset label and the other exercises in the same block, per log id (only logs done as a superset). */
export async function supersetNotes(db: TenantClient, logIds: string[]): Promise<Map<string, { label: string; partners: string[] }>> {
  const out = new Map<string, { label: string; partners: string[] }>();
  if (logIds.length === 0) return out;
  const logs = await db.workoutLog.findMany({
    where: { id: { in: logIds }, planItem: { supersetGroup: { not: null } } },
    select: { id: true, planItem: { select: { id: true, dayId: true, supersetGroup: true } } },
  });
  if (logs.length === 0) return out;
  const items = await db.workoutPlanItem.findMany({
    where: { dayId: { in: [...new Set(logs.map((l) => l.planItem.dayId))] }, supersetGroup: { not: null } },
    select: { id: true, dayId: true, supersetGroup: true, exercise: { select: { name: true } } },
  });
  for (const l of logs) {
    const label = l.planItem.supersetGroup!;
    const partners = items
      .filter((i) => i.dayId === l.planItem.dayId && i.supersetGroup === label && i.id !== l.planItem.id)
      .map((i) => i.exercise.name);
    out.set(l.id, { label, partners: [...new Set(partners)] });
  }
  return out;
}

/** Exercises a member has logged sets for, most recently logged first. */
export async function loggedExercises(db: TenantClient, memberId: string, limit = 24): Promise<{ id: string; name: string; lastDate: string }[]> {
  const logs = await db.workoutLog.findMany({
    where: { memberId, sets: { some: {} } },
    orderBy: [{ scheduledFor: "desc" }, { id: "asc" }],
    select: { scheduledFor: true, planItem: { select: { exerciseId: true, exercise: { select: { name: true } } } } },
    take: 600,
  });
  const seen = new Map<string, { id: string; name: string; lastDate: string }>();
  for (const l of logs) {
    const id = l.planItem.exerciseId;
    if (!seen.has(id)) seen.set(id, { id, name: l.planItem.exercise.name, lastDate: l.scheduledFor.toISOString().slice(0, 10) });
  }
  return [...seen.values()].slice(0, limit);
}
