import { withAuth } from "@/lib/auth/guard";
import { getOwnerInsights } from "@/lib/api/analytics";

export const dynamic = "force-dynamic";

export const GET = withAuth("getOwnerInsights", async ({ db }) => Response.json(await getOwnerInsights(db)));
