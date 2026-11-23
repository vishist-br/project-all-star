import { withAuth } from "@/lib/auth/guard";
import { readJsonObject } from "@/lib/auth/http";
import { createExcusedAbsence, listExcusedAbsences } from "@/lib/api/excused-absences";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ memberId: string }> };

export const GET = withAuth("listExcusedAbsences", async ({ principal, db }, request: Request, { params }: Ctx) =>
  Response.json(await listExcusedAbsences(db, principal, (await params).memberId, new URL(request.url).searchParams)),
);

export const POST = withAuth("createExcusedAbsence", async ({ principal, db }, request: Request, { params }: Ctx) =>
  Response.json(await createExcusedAbsence(db, principal, (await params).memberId, await readJsonObject(request)), { status: 201 }),
);
