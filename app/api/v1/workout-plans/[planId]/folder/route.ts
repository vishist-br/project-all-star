import { withAuth } from "@/lib/auth/guard";
import { readJsonObject } from "@/lib/auth/http";
import { movePlanToFolder } from "@/lib/api/workout-plans";

export const dynamic = "force-dynamic";

export const PUT = withAuth(
  "movePlanToFolder",
  async ({ principal, db }, request: Request, { params }: { params: Promise<{ planId: string }> }) =>
    Response.json(await movePlanToFolder(db, principal, (await params).planId, await readJsonObject(request))),
);
