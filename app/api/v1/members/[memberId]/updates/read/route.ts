import { withAuth } from "@/lib/auth/guard";
import { readJsonObject } from "@/lib/auth/http";
import { markMemberUpdatesRead } from "@/lib/api/member-updates";

export const dynamic = "force-dynamic";

export const POST = withAuth(
  "markMemberUpdatesRead",
  async ({ principal, db }, request: Request, { params }: { params: Promise<{ memberId: string }> }) => {
    await markMemberUpdatesRead(db, principal, (await params).memberId, await readJsonObject(request));
    return new Response(null, { status: 204 });
  },
);
