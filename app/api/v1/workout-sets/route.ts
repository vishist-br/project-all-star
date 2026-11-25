import { withAuth } from "@/lib/auth/guard";
import { readJsonObject } from "@/lib/auth/http";
import { recordWorkoutSets } from "@/lib/api/workout-sets";

export const dynamic = "force-dynamic";

export const PUT = withAuth("recordWorkoutSets", async ({ principal, db }, request: Request) =>
  Response.json(await recordWorkoutSets(db, principal, await readJsonObject(request))),
);
