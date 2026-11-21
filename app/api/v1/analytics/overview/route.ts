import { withAuth } from "@/lib/auth/guard";
import { getOwnerOverview } from "@/lib/api/analytics";

export const dynamic = "force-dynamic";

export const GET = withAuth("getOwnerOverview", async ({ db }, request: Request) => Response.json(await getOwnerOverview(db, new URL(request.url).searchParams)));
