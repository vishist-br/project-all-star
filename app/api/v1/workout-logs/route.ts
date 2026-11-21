import { withAuth } from "@/lib/auth/guard";
import { readJsonObject } from "@/lib/auth/http";
import { recordWorkoutLog } from "@/lib/api/workout-logs";

export const dynamic = "force-dynamic";

export const PUT = withAuth("recordWorkoutLog", async ({ principal, db }, request: Request) =>
  Response.json(await recordWorkoutLog(db, principal, await readJsonObject(request))),
);
