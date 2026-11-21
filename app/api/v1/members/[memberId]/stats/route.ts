import { withAuth } from "@/lib/auth/guard";
import { getMemberStats } from "@/lib/api/member-stats";

export const dynamic = "force-dynamic";

export const GET = withAuth(
  "getMemberStats",
  async ({ principal, db }, request: Request, { params }: { params: Promise<{ memberId: string }> }) =>
    Response.json(await getMemberStats(db, principal, (await params).memberId, new URL(request.url).searchParams)),
);
