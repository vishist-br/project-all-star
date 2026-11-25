import type { Prisma } from "@prisma/client";
import { assertCanManageMember, assertCanViewMember } from "../auth/access";
import { ApiError } from "../auth/errors";
import type { Principal } from "../auth/principal";
import type { TenantClient } from "../tenant-scope";
import { Problems, dateFromDb, isRecord, textField } from "../workouts/validate";

const checklistInclude = {
  sport: { select: { slug: true, name: true } },
  level: { select: { name: true, rank: true, colorHex: true } },
  items: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
} satisfies Prisma.SkillChecklistInclude;

/** GET /skill-checklists (listSkillChecklists): the tenant's belt and skill checklists, in order. */
export async function listSkillChecklists(db: TenantClient, params: URLSearchParams) {
  const sportId = params.get("sportId");
  const levelId = params.get("levelId");
  const rows = await db.skillChecklist.findMany({
    where: { ...(sportId ? { sportId } : {}), ...(levelId ? { levelId } : {}) },
    orderBy: [{ sportId: "asc" }, { sortOrder: "asc" }, { id: "asc" }],
    include: checklistInclude,
    take: 200,
  });
  return {
    items: rows.map((c) => ({
      id: c.id,
      sportId: c.sportId,
      sportSlug: c.sport.slug,
      sportName: c.sport.name,
      levelId: c.levelId,
      levelName: c.level?.name ?? null,
      levelRank: c.level?.rank ?? null,
      levelColorHex: c.level?.colorHex ?? null,
      title: c.title,
      sortOrder: c.sortOrder,
      items: c.items.map((i) => ({ id: i.id, title: i.title, description: i.description, sortOrder: i.sortOrder })),
    })),
  };
}

/**
 * GET /members/{memberId}/skill-progress (getMemberSkillProgress). Every checklist (optionally of one
 * sport) with the member's sign-offs, counts and which checklist is the member's next belt. Same
 * visibility as getMember.
 */
export async function getMemberSkillProgress(db: TenantClient, p: Principal, memberId: string, params: URLSearchParams) {
  await assertCanViewMember(db, p, memberId);
  const sportId = params.get("sportId");
  const [checklists, signOffs, levelRows] = await Promise.all([
    db.skillChecklist.findMany({
      where: sportId ? { sportId } : {},
      orderBy: [{ sportId: "asc" }, { sortOrder: "asc" }, { id: "asc" }],
      include: checklistInclude,
      take: 200,
    }),
    db.skillSignOff.findMany({ where: { memberId }, include: { signedOffBy: { select: { name: true } } } }),
    db.memberLevel.findMany({
      where: { memberId },
      orderBy: [{ achievedOn: "desc" }, { id: "asc" }],
      include: { level: { select: { sportId: true, name: true, rank: true } } },
    }),
  ]);
  const signBy = new Map(signOffs.map((s) => [s.skillItemId, s]));
  // Current level per sport: the latest timeline row.
  const current = new Map<string, { levelId: string; levelName: string; rank: number; achievedOn: string }>();
  for (const m of levelRows) {
    if (!current.has(m.level.sportId)) current.set(m.level.sportId, { levelId: m.levelId, levelName: m.level.name, rank: m.level.rank, achievedOn: dateFromDb(m.achievedOn) });
  }
  // The next belt per sport: the lowest-ranked level above the current one that has a checklist.
  const target = new Map<string, number>();
  for (const c of checklists) {
    if (c.level === null) continue;
    const cur = current.get(c.sportId)?.rank ?? 0;
    if (c.level.rank > cur && (!target.has(c.sportId) || c.level.rank < target.get(c.sportId)!)) target.set(c.sportId, c.level.rank);
  }
  return {
    memberId,
    currentLevels: [...current.entries()].map(([sid, l]) => ({ sportId: sid, ...l })),
    checklists: checklists.map((c) => {
      const items = c.items.map((i) => {
        const s = signBy.get(i.id);
        return {
          skillItemId: i.id,
          title: i.title,
          description: i.description,
          sortOrder: i.sortOrder,
          signedOff: Boolean(s),
          rating: s?.rating ?? null,
          note: s?.note ?? null,
          signedOffAt: s?.signedOffAt.toISOString() ?? null,
          signedOffByName: s?.signedOffBy?.name ?? null,
        };
      });
      const done = items.filter((i) => i.signedOff).length;
      return {
        checklistId: c.id,
        sportId: c.sportId,
        sportName: c.sport.name,
        levelId: c.levelId,
        levelName: c.level?.name ?? null,
        levelRank: c.level?.rank ?? null,
        levelColorHex: c.level?.colorHex ?? null,
        title: c.title,
        isNextLevel: c.level !== null && target.get(c.sportId) === c.level.rank,
        doneCount: done,
        totalCount: items.length,
        percent: items.length === 0 ? 0 : Math.round((100 * done) / items.length),
        complete: items.length > 0 && done === items.length,
        items,
      };
    }),
  };
}

/** PUT /members/{memberId}/skill-sign-offs/{skillItemId} (signOffSkill): rating 1-4, replaces an earlier sign-off. */
export async function signOffSkill(db: TenantClient, p: Principal, memberId: string, skillItemId: string, body: unknown, now = new Date()) {
  if (!isRecord(body)) throw new ApiError("validation_failed", "Body must be a JSON object");
  const v = new Problems();
  const rating = body.rating;
  if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 4) v.add("rating", "Integer 1..4");
  const note = textField(v, body, "note", "", 280);
  v.throwIfAny();
  await assertCanManageMember(db, p, memberId);
  const item = await db.skillItem.findFirst({ where: { id: skillItemId }, select: { id: true } });
  if (!item) throw new ApiError("not_found", "Skill not found");
  const existing = await db.skillSignOff.findFirst({ where: { memberId, skillItemId }, select: { id: true } });
  const data = { rating: rating as number, note, signedOffById: p.userId, signedOffAt: now };
  const row = existing
    ? await db.skillSignOff.update({ where: { id: existing.id }, data, include: { signedOffBy: { select: { name: true } } } })
    : await db.skillSignOff.create({ data: { ...data, memberId, skillItemId } as never, include: { signedOffBy: { select: { name: true } } } });
  return {
    memberId,
    skillItemId,
    rating: row.rating,
    note: row.note,
    signedOffAt: row.signedOffAt.toISOString(),
    signedOffById: row.signedOffById,
    signedOffByName: row.signedOffBy?.name ?? null,
  };
}

/** DELETE /members/{memberId}/skill-sign-offs/{skillItemId} (clearSkillSignOff). Answers 204 even when nothing was signed off. */
export async function clearSkillSignOff(db: TenantClient, p: Principal, memberId: string, skillItemId: string): Promise<void> {
  await assertCanManageMember(db, p, memberId);
  const item = await db.skillItem.findFirst({ where: { id: skillItemId }, select: { id: true } });
  if (!item) throw new ApiError("not_found", "Skill not found");
  await db.skillSignOff.deleteMany({ where: { memberId, skillItemId } });
}
