import { withAuth } from "@/lib/auth/guard";
import { getExercise } from "@/lib/api/exercises";

export const dynamic = "force-dynamic";

export const GET = withAuth(
  "getExercise",
  async ({ db }, _request: Request, { params }: { params: Promise<{ exerciseId: string }> }) =>
    Response.json(await getExercise(db, (await params).exerciseId)),
);
