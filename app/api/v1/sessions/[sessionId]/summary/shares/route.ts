import { withAuth } from "@/lib/auth/guard";
import { readJsonObject } from "@/lib/auth/http";
import { createClassSummaryShare } from "@/lib/api/class-summary";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ sessionId: string }> };

export const POST = withAuth("createClassSummaryShare", async ({ principal, db }, request: Request, { params }: Ctx) =>
  Response.json(await createClassSummaryShare(db, principal, (await params).sessionId, await readJsonObject(request)), { status: 201 }),
);
