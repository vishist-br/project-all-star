import { withAuth } from "@/lib/auth/guard";
import { readJsonObject } from "@/lib/auth/http";
import { sendPlanToMembers } from "@/lib/api/bulk-send";

export const dynamic = "force-dynamic";

export const POST = withAuth("sendPlanToMembers", async ({ principal, db }, request: Request) =>
  Response.json(await sendPlanToMembers(db, principal, await readJsonObject(request))),
);
