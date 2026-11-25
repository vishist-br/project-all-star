import { withAuth } from "@/lib/auth/guard";
import { getMuscleVolume } from "@/lib/api/muscle-volume";

export const dynamic = "force-dynamic";

export const GET = withAuth("getMuscleVolume", async ({ principal, db }, request: Request, { params }: { params: Promise<{ memberId: string }> }) =>
  Response.json(await getMuscleVolume(db, principal, (await params).memberId, new URL(request.url).searchParams)),
);
