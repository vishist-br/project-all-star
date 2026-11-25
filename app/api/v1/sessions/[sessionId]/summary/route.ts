import { withAuth } from "@/lib/auth/guard";
import { readJsonObject } from "@/lib/auth/http";
import { getClassSummary, publishClassSummary } from "@/lib/api/class-summary";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ sessionId: string }> };

export const GET = withAuth("getClassSummary", async ({ principal, db }, request: Request, { params }: Ctx) =>
  Response.json(await getClassSummary(db, principal, (await params).sessionId, new URL(request.url).searchParams)),
);

export const POST = withAuth("publishClassSummary", async ({ principal, db }, request: Request, { params }: Ctx) =>
  Response.json(await publishClassSummary(db, principal, (await params).sessionId, await readJsonObject(request))),
);
