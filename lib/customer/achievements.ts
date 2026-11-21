import { assertCanViewMember } from "@/lib/auth/access";
import type { Principal } from "@/lib/auth/principal";
import { tenantDate } from "@/lib/api/pagination";
import type { TenantClient } from "@/lib/tenant-scope";

export type AchievementView = { id: string; title: string; earnedOn: string };

/**
 * Achievements the member has earned, newest first. The v0.2.0 contract has no achievements
 * operation yet, so this reads the table through the tenant-scoped client after the same
 * "own or child's member" check every member read uses.
 */
export async function listAchievements(db: TenantClient, p: Principal, memberId: string, limit = 12): Promise<AchievementView[]> {
  await assertCanViewMember(db, p, memberId);
  const rows = await db.achievement.findMany({
    where: { memberId },
    orderBy: [{ earnedAt: "desc" }, { id: "asc" }],
    take: limit,
    select: { id: true, title: true, earnedAt: true },
  });
  return rows.map((r) => ({ id: r.id, title: r.title, earnedOn: tenantDate(r.earnedAt) }));
}
