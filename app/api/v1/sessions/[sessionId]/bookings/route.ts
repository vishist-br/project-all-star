import { withAuth } from "@/lib/auth/guard";
import { readJsonObject } from "@/lib/auth/http";
import { bookSession } from "@/lib/api/bookings";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ sessionId: string }> };

export const POST = withAuth("bookSession", async ({ principal, db }, request: Request, { params }: Ctx) =>
  Response.json(await bookSession(db, principal, (await params).sessionId, await readJsonObject(request)), { status: 201 }),
);
