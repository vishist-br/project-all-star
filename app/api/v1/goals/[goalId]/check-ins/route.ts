import { withAuth } from "@/lib/auth/guard";
import { readJsonObject } from "@/lib/auth/http";
import { addGoalCheckIn } from "@/lib/api/goals";

export const dynamic = "force-dynamic";

export const POST = withAuth(
  "addGoalCheckIn",
  async ({ principal, db }, request: Request, { params }: { params: Promise<{ goalId: string }> }) =>
    Response.json(await addGoalCheckIn(db, principal, (await params).goalId, await readJsonObject(request)), { status: 201 }),
);
