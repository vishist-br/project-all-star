import { withAuth } from "@/lib/auth/guard";
import { listCoaches } from "@/lib/api/coaches";

export const dynamic = "force-dynamic";

export const GET = withAuth("listCoaches", async ({ db }) => Response.json(await listCoaches(db)));
