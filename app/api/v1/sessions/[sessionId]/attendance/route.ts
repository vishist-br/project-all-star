import { withAuth } from "@/lib/auth/guard";
import { readJsonObject } from "@/lib/auth/http";
import { recordAttendance } from "@/lib/api/attendance";

export const dynamic = "force-dynamic";

export const PUT = withAuth(
  "recordAttendance",
  async ({ principal, db }, request: Request, { params }: { params: Promise<{ sessionId: string }> }) =>
    Response.json(await recordAttendance(db, principal, (await params).sessionId, await readJsonObject(request))),
);
