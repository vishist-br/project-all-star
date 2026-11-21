import { withAuth } from "@/lib/auth/guard";
import { readJsonObject } from "@/lib/auth/http";
import { createPlanAssignments, listPlanAssignments } from "@/lib/api/assignments";

export const dynamic = "force-dynamic";

export const GET = withAuth("listPlanAssignments", async ({ principal, db }, request) =>
  Response.json(await listPlanAssignments(db, principal, new URL(request.url).searchParams)),
);

export const POST = withAuth("createPlanAssignments", async ({ principal, db }, request) =>
  Response.json(await createPlanAssignments(db, principal, await readJsonObject(request)), { status: 201 }),
);
