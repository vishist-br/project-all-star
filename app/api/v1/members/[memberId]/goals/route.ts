import { withAuth } from "@/lib/auth/guard";
import { readJsonObject } from "@/lib/auth/http";
import { createGoal, listGoals } from "@/lib/api/goals";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ memberId: string }> };

export const GET = withAuth("listGoals", async ({ principal, db }, request: Request, { params }: Ctx) =>
  Response.json(await listGoals(db, principal, (await params).memberId, new URL(request.url).searchParams)),
);

export const POST = withAuth("createGoal", async ({ principal, db }, request: Request, { params }: Ctx) =>
  Response.json(await createGoal(db, principal, (await params).memberId, await readJsonObject(request)), { status: 201 }),
);
