import { withAuth } from "@/lib/auth/guard";
import { listBatches } from "@/lib/api/batches";

export const dynamic = "force-dynamic";

export const GET = withAuth("listBatches", async ({ principal, db }, request) =>
  Response.json(await listBatches(db, principal, new URL(request.url).searchParams)),
);
