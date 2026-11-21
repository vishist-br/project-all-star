import { withAuth } from "@/lib/auth/guard";
import { getOwnerTrends } from "@/lib/api/analytics";

export const dynamic = "force-dynamic";

export const GET = withAuth("getOwnerTrends", async ({ db }, request: Request) => Response.json(await getOwnerTrends(db, new URL(request.url).searchParams)));
