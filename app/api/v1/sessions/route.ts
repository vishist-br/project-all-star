import { withAuth } from "@/lib/auth/guard";
import { listSessions } from "@/lib/api/sessions";

export const dynamic = "force-dynamic";

export const GET = withAuth("listSessions", async ({ principal, db }, request) =>
  Response.json(await listSessions(db, principal, new URL(request.url).searchParams)),
);
