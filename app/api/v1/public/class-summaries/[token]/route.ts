import { errorResponse } from "@/lib/auth/errors";
import { getSharedClassSummary } from "@/lib/api/class-summary";

export const dynamic = "force-dynamic";

const PRIVATE = { "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store" };

/** Public share link of one member's class summary. Never indexed, never cached. */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    return Response.json(await getSharedClassSummary((await params).token), { headers: PRIVATE });
  } catch (err) {
    const res = errorResponse(err);
    for (const [k, v] of Object.entries(PRIVATE)) res.headers.set(k, v);
    return res;
  }
}
