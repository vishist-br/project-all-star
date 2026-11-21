import { withAuth } from "@/lib/auth/guard";
import { listVenues } from "@/lib/api/venues";

export const dynamic = "force-dynamic";

export const GET = withAuth("listVenues", async ({ principal, db }, request) =>
  Response.json(await listVenues(db, principal, new URL(request.url).searchParams)),
);
