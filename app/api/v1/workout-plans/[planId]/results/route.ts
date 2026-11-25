import { withAuth } from "@/lib/auth/guard";
import { getPlanResults } from "@/lib/api/bulk-send";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ planId: string }> };

export const GET = withAuth("getPlanResults", async ({ principal, db }, request: Request, { params }: Ctx) =>
  Response.json(await getPlanResults(db, principal, (await params).planId, new URL(request.url).searchParams)),
);
