import { prisma } from "@/lib/db";
import { errorResponse } from "@/lib/auth/errors";
import { getThemeBySlug } from "@/lib/theme";

export const dynamic = "force-dynamic";

/** Public: themes the sign-in page before login. Business name, logo and colors only. */
export async function GET(_request: Request, { params }: { params: Promise<{ tenantSlug: string }> }) {
  try {
    const { tenantSlug } = await params;
    return Response.json(await getThemeBySlug(prisma, tenantSlug));
  } catch (err) {
    return errorResponse(err);
  }
}
