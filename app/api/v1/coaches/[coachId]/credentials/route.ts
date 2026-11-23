import { withAuth } from "@/lib/auth/guard";
import { readJsonObject } from "@/lib/auth/http";
import { createCoachCredential, listCoachCredentials } from "@/lib/api/coach-credentials";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ coachId: string }> };

export const GET = withAuth("listCoachCredentials", async ({ principal, db }, _request: Request, { params }: Ctx) =>
  Response.json(await listCoachCredentials(db, principal, (await params).coachId)),
);

export const POST = withAuth("createCoachCredential", async ({ principal, db }, request: Request, { params }: Ctx) =>
  Response.json(await createCoachCredential(db, principal, (await params).coachId, await readJsonObject(request)), { status: 201 }),
);
