import { withAuth } from "@/lib/auth/guard";
import { readJsonObject } from "@/lib/auth/http";
import { listSessions } from "@/lib/api/sessions";
import { createSession } from "@/lib/api/session-write";

export const dynamic = "force-dynamic";

export const GET = withAuth("listSessions", async ({ principal, db }, request) =>
  Response.json(await listSessions(db, principal, new URL(request.url).searchParams)),
);

export const POST = withAuth("createSession", async ({ principal, db }, request) =>
  Response.json(await createSession(db, principal, await readJsonObject(request)), { status: 201 }),
);
