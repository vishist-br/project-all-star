import { withAuth } from "@/lib/auth/guard";
import { deleteHoliday } from "@/lib/api/holidays";

export const dynamic = "force-dynamic";

export const DELETE = withAuth(
  "deleteHoliday",
  async ({ db }, _request: Request, { params }: { params: Promise<{ holidayId: string }> }) => {
    await deleteHoliday(db, (await params).holidayId);
    return new Response(null, { status: 204 });
  },
);
