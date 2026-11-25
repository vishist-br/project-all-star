import { getClassSummary, getMemberClassSummaries, type ClassWorkout } from "../api/class-summary";
import { getMemberSkillProgress } from "../api/skills";
import { ApiError } from "../auth/errors";
import type { Principal } from "../auth/principal";
import type { TenantClient } from "../tenant-scope";
import { nextBelt, type BeltLike } from "./view";

/** One class summary as the member screens use it (getClassSummary / getMemberClassSummaries, counts always null for customers). */
export type MemberSummary = {
  id: string;
  sessionId: string;
  batchName: string;
  startsAt: string;
  endsAt: string;
  coachNote: string | null;
  homePractice: string | null;
  publishedAt: string;
  workout: ClassWorkout | null;
  forMember: { memberId: string; status: "present" | "absent" | "excused"; titleKey: string; bodyKey: string; params: { firstName: string; batchName: string; date: string } };
};

export async function loadMemberSummaries(db: TenantClient, p: Principal, memberId: string, limit: number, cursor?: string | null) {
  const q = new URLSearchParams({ limit: String(limit) });
  if (cursor) q.set("cursor", cursor);
  const res = await getMemberClassSummaries(db, p, memberId, q);
  return { items: res.items as unknown as MemberSummary[], nextCursor: res.nextCursor };
}

/** One summary for one member, or null when it is not published or not theirs (the page then shows a friendly notice). */
export async function loadMemberSummary(db: TenantClient, p: Principal, sessionId: string, memberId: string): Promise<MemberSummary | null> {
  try {
    return (await getClassSummary(db, p, sessionId, new URLSearchParams({ memberId }))) as unknown as MemberSummary;
  } catch (err) {
    if (err instanceof ApiError && (err.code === "not_found" || err.code === "forbidden" || err.code === "validation_failed")) return null;
    throw err;
  }
}

/** The member's next belt as a progress line. Null when there is no checklist (not every sport has belts) or it cannot be read. */
export async function loadBelt(db: TenantClient, p: Principal, memberId: string): Promise<BeltLike | null> {
  try {
    return nextBelt(await getMemberSkillProgress(db, p, memberId, new URLSearchParams()));
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}
