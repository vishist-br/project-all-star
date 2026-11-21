import { withAuth } from "@/lib/auth/guard";
import { readJsonObject } from "@/lib/auth/http";
import { updateGoal } from "@/lib/api/goals";

export const dynamic = "force-dynamic";

export const PATCH = withAuth(
  "updateGoal",
  async ({ principal, db }, request: Request, { params }: { params: Promise<{ goalId: string }> }) =>
    Response.json(await updateGoal(db, principal, (await params).goalId, await readJsonObject(request))),
);
