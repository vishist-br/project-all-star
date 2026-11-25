import { withAuth } from "@/lib/auth/guard";
import { deleteBodyMeasurement } from "@/lib/api/body-measurements";

export const dynamic = "force-dynamic";

export const DELETE = withAuth(
  "deleteBodyMeasurement",
  async ({ principal, db }, _request: Request, { params }: { params: Promise<{ memberId: string; measurementId: string }> }) => {
    const { memberId, measurementId } = await params;
    await deleteBodyMeasurement(db, principal, memberId, measurementId);
    return new Response(null, { status: 204 });
  },
);
