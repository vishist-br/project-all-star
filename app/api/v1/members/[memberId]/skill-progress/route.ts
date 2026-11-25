import { withAuth } from "@/lib/auth/guard";
import { getMemberSkillProgress } from "@/lib/api/skills";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ memberId: string }> };

export const GET = withAuth("getMemberSkillProgress", async ({ principal, db }, request: Request, { params }: Ctx) =>
  Response.json(await getMemberSkillProgress(db, principal, (await params).memberId, new URL(request.url).searchParams)),
);
