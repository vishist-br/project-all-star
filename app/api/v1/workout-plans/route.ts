import { withAuth } from "@/lib/auth/guard";
import { readJsonObject } from "@/lib/auth/http";
import { createWorkoutPlan, listWorkoutPlans } from "@/lib/api/workout-plans";

export const dynamic = "force-dynamic";

export const GET = withAuth("listWorkoutPlans", async ({ principal, db }, request) =>
  Response.json(await listWorkoutPlans(db, principal, new URL(request.url).searchParams)),
);

export const POST = withAuth("createWorkoutPlan", async ({ principal, db }, request) =>
  Response.json(await createWorkoutPlan(db, principal, await readJsonObject(request)), { status: 201 }),
);
