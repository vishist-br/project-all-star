import { withAuth } from "@/lib/auth/guard";
import { listMemberUpdates } from "@/lib/api/member-updates";

export const dynamic = "force-dynamic";

export const GET = withAuth(
  "listMemberUpdates",
  async ({ principal, db }, request: Request, { params }: { params: Promise<{ memberId: string }> }) =>
    Response.json(await listMemberUpdates(db, principal, (await params).memberId, new URL(request.url).searchParams)),
);
