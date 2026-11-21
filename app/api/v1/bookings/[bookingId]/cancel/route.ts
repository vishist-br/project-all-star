import { withAuth } from "@/lib/auth/guard";
import { cancelBooking } from "@/lib/api/bookings";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ bookingId: string }> };

export const POST = withAuth("cancelBooking", async ({ principal, db }, _request: Request, { params }: Ctx) =>
  Response.json(await cancelBooking(db, principal, (await params).bookingId)),
);
