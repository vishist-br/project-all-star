import { withAuth } from "@/lib/auth/guard";
import { readJsonObject } from "@/lib/auth/http";
import { createHoliday, listHolidays } from "@/lib/api/holidays";

export const dynamic = "force-dynamic";

export const GET = withAuth("listHolidays", async ({ db }, request) =>
  Response.json(await listHolidays(db, new URL(request.url).searchParams)),
);

export const POST = withAuth("createHoliday", async ({ principal, db }, request: Request) =>
  Response.json(await createHoliday(db, principal.tenantId, await readJsonObject(request)), { status: 201 }),
);
