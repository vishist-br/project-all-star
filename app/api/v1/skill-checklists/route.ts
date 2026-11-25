import { withAuth } from "@/lib/auth/guard";
import { listSkillChecklists } from "@/lib/api/skills";

export const dynamic = "force-dynamic";

export const GET = withAuth("listSkillChecklists", async ({ db }, request: Request) =>
  Response.json(await listSkillChecklists(db, new URL(request.url).searchParams)),
);
