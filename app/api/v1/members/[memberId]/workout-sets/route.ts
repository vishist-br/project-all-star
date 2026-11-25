import { withAuth } from "@/lib/auth/guard";
import { listWorkoutSets } from "@/lib/api/workout-sets";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ memberId: string }> };

export const GET = withAuth("listWorkoutSets", async ({ principal, db }, request: Request, { params }: Ctx) =>
  Response.json(await listWorkoutSets(db, principal, (await params).memberId, new URL(request.url).searchParams)),
);
