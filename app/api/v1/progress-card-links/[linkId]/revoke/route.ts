import { withAuth } from "@/lib/auth/guard";
import { revokeProgressCardLink } from "@/lib/api/progress-card";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ linkId: string }> };

export const POST = withAuth("revokeProgressCardLink", async ({ principal, db }, _request: Request, { params }: Ctx) =>
  Response.json(await revokeProgressCardLink(db, principal, (await params).linkId)),
);
