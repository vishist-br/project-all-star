import { withAuth } from "@/lib/auth/guard";
import { getProgressCard } from "@/lib/api/progress-card";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ memberId: string }> };

export const GET = withAuth("getProgressCard", async ({ principal, db }, request: Request, { params }: Ctx) =>
  Response.json(await getProgressCard(db, principal, (await params).memberId, new URL(request.url).searchParams)),
);
