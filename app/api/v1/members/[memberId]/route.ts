import { withAuth } from "@/lib/auth/guard";
import { getMember } from "@/lib/api/members";

export const dynamic = "force-dynamic";

export const GET = withAuth(
  "getMember",
  async ({ principal, db }, _request: Request, { params }: { params: Promise<{ memberId: string }> }) =>
    Response.json(await getMember(db, principal, (await params).memberId)),
);
