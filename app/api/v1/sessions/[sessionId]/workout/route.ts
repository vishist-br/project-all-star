import { withAuth } from "@/lib/auth/guard";
import { readJsonObject } from "@/lib/auth/http";
import { attachSessionWorkout, getSessionWorkout } from "@/lib/api/class-summary";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ sessionId: string }> };

export const GET = withAuth("getSessionWorkout", async ({ principal, db }, _request: Request, { params }: Ctx) =>
  Response.json(await getSessionWorkout(db, principal, (await params).sessionId)),
);

export const PUT = withAuth("attachSessionWorkout", async ({ principal, db }, request: Request, { params }: Ctx) =>
  Response.json(await attachSessionWorkout(db, principal, (await params).sessionId, await readJsonObject(request))),
);
