import { withAuth } from "@/lib/auth/guard";
import { getFeeStats } from "@/lib/api/analytics";

export const dynamic = "force-dynamic";

export const GET = withAuth("getFeeStats", async ({ db }) => Response.json(await getFeeStats(db)));
