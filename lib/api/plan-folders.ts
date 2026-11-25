import type { Principal } from "../auth/principal";
import { ApiError } from "../auth/errors";
import type { TenantClient } from "../tenant-scope";
import { Problems, isRecord } from "../workouts/validate";

const MAX_FOLDERS = 50;

/** A coach sees (and files plans in) their own folders; the owner sees every folder of the business. */
const folderScope = (p: Principal) => (p.role === "owner" ? {} : { coachId: p.userId });

function nameOf(body: unknown): string {
  if (!isRecord(body)) throw new ApiError("validation_failed", "Body must be a JSON object");
  const v = new Problems();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length < 1 || name.length > 60) v.add("name", "Text 1..60 characters");
  v.throwIfAny();
  return name;
}

type Row = { id: string; name: string; sortOrder: number; coachId: string; coach: { name: string }; _count: { plans: number } };
const dto = (r: Row) => ({ id: r.id, name: r.name, order: r.sortOrder, coachId: r.coachId, coachName: r.coach.name, planCount: r._count.plans });
const include = { coach: { select: { name: true } }, _count: { select: { plans: { where: { isTemplate: false } } } } } as const;

/** GET /plan-folders (listPlanFolders): the caller's folders in order, with the number of plans in each. */
export async function listPlanFolders(db: TenantClient, p: Principal) {
  const rows = await db.planFolder.findMany({
    where: folderScope(p),
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
    include,
    take: 200,
  });
  return { items: rows.map(dto) };
}

/** POST /plan-folders (createPlanFolder): added after the caller's last folder. */
export async function createPlanFolder(db: TenantClient, p: Principal, body: unknown) {
  const name = nameOf(body);
  const mine = await db.planFolder.findMany({ where: { coachId: p.userId }, select: { sortOrder: true, name: true } });
  if (mine.length >= MAX_FOLDERS) throw new ApiError("conflict", `Up to ${MAX_FOLDERS} folders`);
  if (mine.some((f) => f.name.toLowerCase() === name.toLowerCase())) throw new ApiError("conflict", "You already have a folder with this name");
  const order = mine.reduce((m, f) => Math.max(m, f.sortOrder), 0) + 1;
  const row = await db.planFolder.create({ data: { coachId: p.userId, name, sortOrder: order } as never, include });
  return dto(row);
}

async function ownFolder(db: TenantClient, p: Principal, folderId: string) {
  const row = await db.planFolder.findFirst({ where: { id: folderId }, select: { id: true, coachId: true } });
  if (!row) throw new ApiError("not_found", "Folder not found");
  if (p.role !== "owner" && row.coachId !== p.userId) throw new ApiError("forbidden", "This folder is not yours");
  return row;
}

/** PATCH /plan-folders/{folderId} (renamePlanFolder). */
export async function renamePlanFolder(db: TenantClient, p: Principal, folderId: string, body: unknown) {
  const name = nameOf(body);
  const folder = await ownFolder(db, p, folderId);
  const clash = await db.planFolder.findFirst({ where: { coachId: folder.coachId, name: { equals: name, mode: "insensitive" }, id: { not: folderId } }, select: { id: true } });
  if (clash) throw new ApiError("conflict", "There is already a folder with this name");
  const row = await db.planFolder.update({ where: { id: folderId }, data: { name }, include });
  return dto(row);
}

/** DELETE /plan-folders/{folderId} (deletePlanFolder): its plans stay and move to "no folder". 204. */
export async function deletePlanFolder(db: TenantClient, p: Principal, folderId: string): Promise<void> {
  await ownFolder(db, p, folderId);
  await db.$transaction(async (raw) => {
    const tx = raw as unknown as TenantClient;
    await tx.workoutPlan.updateMany({ where: { folderId }, data: { folderId: null } });
    await tx.planFolder.deleteMany({ where: { id: folderId } });
  });
}
