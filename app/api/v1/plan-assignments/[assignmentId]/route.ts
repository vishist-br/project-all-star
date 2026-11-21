import { withAuth } from "@/lib/auth/guard";
import { readJsonObject } from "@/lib/auth/http";
import { updatePlanAssignment } from "@/lib/api/assignments";

export const dynamic = "force-dynamic";

export const PATCH = withAuth(
  "updatePlanAssignment",
  async ({ principal, db }, request: Request, { params }: { params: Promise<{ assignmentId: string }> }) =>
    Response.json(await updatePlanAssignment(db, principal, (await params).assignmentId, await readJsonObject(request))),
);
