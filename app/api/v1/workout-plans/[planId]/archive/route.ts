import { withAuth } from "@/lib/auth/guard";
import { archiveWorkoutPlan } from "@/lib/api/workout-plans";

export const dynamic = "force-dynamic";

export const POST = withAuth(
  "archiveWorkoutPlan",
  async ({ principal, db }, _request: Request, { params }: { params: Promise<{ planId: string }> }) =>
    Response.json(await archiveWorkoutPlan(db, principal, (await params).planId)),
);
