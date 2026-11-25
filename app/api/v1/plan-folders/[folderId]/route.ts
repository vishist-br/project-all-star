import { withAuth } from "@/lib/auth/guard";
import { readJsonObject } from "@/lib/auth/http";
import { deletePlanFolder, renamePlanFolder } from "@/lib/api/plan-folders";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ folderId: string }> };

export const PATCH = withAuth("renamePlanFolder", async ({ principal, db }, request: Request, { params }: Ctx) =>
  Response.json(await renamePlanFolder(db, principal, (await params).folderId, await readJsonObject(request))),
);

export const DELETE = withAuth("deletePlanFolder", async ({ principal, db }, _request: Request, { params }: Ctx) => {
  await deletePlanFolder(db, principal, (await params).folderId);
  return new Response(null, { status: 204 });
});
