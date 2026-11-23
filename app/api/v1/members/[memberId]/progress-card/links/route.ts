import { withAuth } from "@/lib/auth/guard";
import { readJsonObject } from "@/lib/auth/http";
import { createProgressCardLink, listProgressCardLinks } from "@/lib/api/progress-card";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ memberId: string }> };

export const GET = withAuth("listProgressCardLinks", async ({ principal, db }, _request: Request, { params }: Ctx) =>
  Response.json(await listProgressCardLinks(db, principal, (await params).memberId)),
);

export const POST = withAuth("createProgressCardLink", async ({ principal, db }, request: Request, { params }: Ctx) =>
  Response.json(await createProgressCardLink(db, principal, (await params).memberId, await readJsonObject(request)), {
    status: 201,
    headers: { "Cache-Control": "no-store" },
  }),
);
