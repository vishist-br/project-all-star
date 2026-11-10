import { withAuth } from "@/lib/auth/guard";
import { listMembers } from "@/lib/api/members";

export const dynamic = "force-dynamic";

export const GET = withAuth("listMembers", async ({ principal, db }, request) =>
  Response.json(await listMembers(db, principal, new URL(request.url).searchParams)),
);
