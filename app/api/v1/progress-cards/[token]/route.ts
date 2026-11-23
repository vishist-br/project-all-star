import { prisma } from "@/lib/db";
import { errorResponse } from "@/lib/auth/errors";
import { getSharedProgressCard } from "@/lib/api/progress-card";

export const dynamic = "force-dynamic";

/** Public: the token in the path is the only credential. Never cached, never indexed. */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const card = await getSharedProgressCard(prisma, (await params).token);
    return Response.json(card, { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" } });
  } catch (err) {
    return errorResponse(err);
  }
}
