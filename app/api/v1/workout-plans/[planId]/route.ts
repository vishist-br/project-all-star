import { withAuth } from "@/lib/auth/guard";
import { readJsonObject } from "@/lib/auth/http";
import { getWorkoutPlan, updateWorkoutPlan } from "@/lib/api/workout-plans";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ planId: string }> };

export const GET = withAuth("getWorkoutPlan", async ({ principal, db }, _request: Request, { params }: Ctx) =>
  Response.json(await getWorkoutPlan(db, principal, (await params).planId)),
);

export const PUT = withAuth("updateWorkoutPlan", async ({ principal, db }, request: Request, { params }: Ctx) =>
  Response.json(await updateWorkoutPlan(db, principal, (await params).planId, await readJsonObject(request))),
);
