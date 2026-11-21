import { withAuth } from "@/lib/auth/guard";
import { readJsonObject } from "@/lib/auth/http";
import { getSession } from "@/lib/api/session-detail";
import { updateSession } from "@/lib/api/session-write";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ sessionId: string }> };

export const GET = withAuth("getSession", async ({ principal, db }, _request: Request, { params }: Ctx) =>
  Response.json(await getSession(db, principal, (await params).sessionId)),
);

export const PATCH = withAuth("updateSession", async ({ principal, db }, request: Request, { params }: Ctx) =>
  Response.json(await updateSession(db, principal, (await params).sessionId, await readJsonObject(request))),
);
