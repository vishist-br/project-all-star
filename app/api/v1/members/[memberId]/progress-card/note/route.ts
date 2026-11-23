import { withAuth } from "@/lib/auth/guard";
import { readJsonObject } from "@/lib/auth/http";
import { getProgressNote, saveProgressNote } from "@/lib/api/progress-card";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ memberId: string }> };

export const GET = withAuth("getProgressNote", async ({ principal, db }, request: Request, { params }: Ctx) =>
  Response.json(await getProgressNote(db, principal, (await params).memberId, new URL(request.url).searchParams)),
);

export const PUT = withAuth("saveProgressNote", async ({ principal, db }, request: Request, { params }: Ctx) =>
  Response.json(await saveProgressNote(db, principal, (await params).memberId, await readJsonObject(request))),
);
