import { withAuth } from "@/lib/auth/guard";
import { getCoachWorkload } from "@/lib/api/analytics";

export const dynamic = "force-dynamic";

export const GET = withAuth("getCoachWorkload", async ({ db }, request: Request) => Response.json(await getCoachWorkload(db, new URL(request.url).searchParams)));
