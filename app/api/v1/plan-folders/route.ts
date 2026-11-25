import { withAuth } from "@/lib/auth/guard";
import { readJsonObject } from "@/lib/auth/http";
import { createPlanFolder, listPlanFolders } from "@/lib/api/plan-folders";

export const dynamic = "force-dynamic";

export const GET = withAuth("listPlanFolders", async ({ principal, db }) => Response.json(await listPlanFolders(db, principal)));

export const POST = withAuth("createPlanFolder", async ({ principal, db }, request) =>
  Response.json(await createPlanFolder(db, principal, await readJsonObject(request)), { status: 201 }),
);
