import { withAuth } from "@/lib/auth/guard";
import { listWorkoutLogs } from "@/lib/api/workout-logs";

export const dynamic = "force-dynamic";

export const GET = withAuth(
  "listWorkoutLogs",
  async ({ principal, db }, request: Request, { params }: { params: Promise<{ memberId: string }> }) =>
    Response.json(await listWorkoutLogs(db, principal, (await params).memberId, new URL(request.url).searchParams)),
);
