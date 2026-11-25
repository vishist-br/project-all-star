import { withAuth } from "@/lib/auth/guard";
import { readJsonObject } from "@/lib/auth/http";
import { listBodyMeasurements, recordBodyMeasurement } from "@/lib/api/body-measurements";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ memberId: string }> };

export const GET = withAuth("listBodyMeasurements", async ({ principal, db }, request: Request, { params }: Ctx) =>
  Response.json(await listBodyMeasurements(db, principal, (await params).memberId, new URL(request.url).searchParams)),
);

export const POST = withAuth("recordBodyMeasurement", async ({ principal, db }, request: Request, { params }: Ctx) =>
  Response.json(await recordBodyMeasurement(db, principal, (await params).memberId, await readJsonObject(request)), { status: 201 }),
);
