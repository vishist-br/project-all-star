import { withAuth } from "@/lib/auth/guard";
import { listPlanTemplates } from "@/lib/api/workout-plans";

export const dynamic = "force-dynamic";

export const GET = withAuth("listPlanTemplates", async ({ principal, db }) => Response.json(await listPlanTemplates(db, principal)));
