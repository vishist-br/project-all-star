import { withAuth } from "@/lib/auth/guard";
import { readJsonObject } from "@/lib/auth/http";
import { clearSkillSignOff, signOffSkill } from "@/lib/api/skills";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ memberId: string; skillItemId: string }> };

export const PUT = withAuth("signOffSkill", async ({ principal, db }, request: Request, { params }: Ctx) => {
  const { memberId, skillItemId } = await params;
  return Response.json(await signOffSkill(db, principal, memberId, skillItemId, await readJsonObject(request)));
});

export const DELETE = withAuth("clearSkillSignOff", async ({ principal, db }, _request: Request, { params }: Ctx) => {
  const { memberId, skillItemId } = await params;
  await clearSkillSignOff(db, principal, memberId, skillItemId);
  return new Response(null, { status: 204 });
});
