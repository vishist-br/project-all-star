import { withAuth } from "@/lib/auth/guard";
import { getMemberSchedule } from "@/lib/api/schedule";

export const dynamic = "force-dynamic";

export const GET = withAuth(
  "getMemberSchedule",
  async ({ principal, db }, request: Request, { params }: { params: Promise<{ memberId: string }> }) =>
    Response.json(await getMemberSchedule(db, principal, (await params).memberId, new URL(request.url).searchParams)),
);
