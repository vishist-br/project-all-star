import { withAuth } from "@/lib/auth/guard";
import { duplicatePlan } from "@/lib/api/workout-plans";

export const dynamic = "force-dynamic";

/** The body is optional: an empty body copies the plan with the default title. */
async function optionalBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    return "not json";
  }
}

export const POST = withAuth(
  "duplicatePlan",
  async ({ principal, db }, request: Request, { params }: { params: Promise<{ planId: string }> }) =>
    Response.json(await duplicatePlan(db, principal, (await params).planId, await optionalBody(request)), { status: 201 }),
);
