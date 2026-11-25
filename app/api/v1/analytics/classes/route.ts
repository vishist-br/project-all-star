import { withAuth } from "@/lib/auth/guard";
import { getClassInsights } from "@/lib/api/class-insights";

export const dynamic = "force-dynamic";

export const GET = withAuth("getClassInsights", async ({ db }, request: Request) =>
  Response.json(await getClassInsights(db, new URL(request.url).searchParams)),
);
