import { withAuth } from "@/lib/auth/guard";
import { getExerciseHistory } from "@/lib/api/workout-sets";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ memberId: string; exerciseId: string }> };

export const GET = withAuth("getExerciseHistory", async ({ principal, db }, request: Request, { params }: Ctx) => {
  const { memberId, exerciseId } = await params;
  return Response.json(await getExerciseHistory(db, principal, memberId, exerciseId, new URL(request.url).searchParams));
});
