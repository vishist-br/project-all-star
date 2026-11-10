import { withAuth } from "@/lib/auth/guard";
import { createMemberMagicLink } from "@/lib/auth/member-link";

export const dynamic = "force-dynamic";

export const POST = withAuth(
  "createMemberMagicLink",
  async ({ principal, db }, _request: Request, { params }: { params: Promise<{ memberId: string }> }) =>
    Response.json(await createMemberMagicLink(db, principal, (await params).memberId)),
);
