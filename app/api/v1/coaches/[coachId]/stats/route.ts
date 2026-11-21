import { withAuth } from "@/lib/auth/guard";
import { getCoachStats } from "@/lib/api/coaches";

export const dynamic = "force-dynamic";

export const GET = withAuth(
  "getCoachStats",
  async ({ principal, db }, request: Request, { params }: { params: Promise<{ coachId: string }> }) =>
    Response.json(await getCoachStats(db, principal, (await params).coachId, new URL(request.url).searchParams)),
);
