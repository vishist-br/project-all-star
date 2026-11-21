import { withAuth } from "@/lib/auth/guard";
import { readJsonObject } from "@/lib/auth/http";
import { listCoachAvailability, replaceCoachAvailability } from "@/lib/api/availability";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ coachId: string }> };

export const GET = withAuth("listCoachAvailability", async ({ principal, db }, _request: Request, { params }: Ctx) =>
  Response.json(await listCoachAvailability(db, principal, (await params).coachId)),
);

export const PUT = withAuth("replaceCoachAvailability", async ({ principal, db }, request: Request, { params }: Ctx) =>
  Response.json(await replaceCoachAvailability(db, principal, (await params).coachId, await readJsonObject(request))),
);
