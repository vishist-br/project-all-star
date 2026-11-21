import { withAuth } from "@/lib/auth/guard";
import { listExercises } from "@/lib/api/exercises";

export const dynamic = "force-dynamic";

export const GET = withAuth("listExercises", async ({ db }, request) =>
  Response.json(await listExercises(db, new URL(request.url).searchParams)),
);
