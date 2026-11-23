import { withAuth } from "@/lib/auth/guard";
import { cancelExcusedAbsence } from "@/lib/api/excused-absences";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ absenceId: string }> };

export const POST = withAuth("cancelExcusedAbsence", async ({ principal, db }, _request: Request, { params }: Ctx) =>
  Response.json(await cancelExcusedAbsence(db, principal, (await params).absenceId)),
);
