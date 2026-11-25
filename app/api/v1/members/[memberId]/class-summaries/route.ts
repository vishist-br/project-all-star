import { withAuth } from "@/lib/auth/guard";
import { getMemberClassSummaries } from "@/lib/api/class-summary";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ memberId: string }> };

export const GET = withAuth("getMemberClassSummaries", async ({ principal, db }, request: Request, { params }: Ctx) =>
  Response.json(await getMemberClassSummaries(db, principal, (await params).memberId, new URL(request.url).searchParams)),
);
