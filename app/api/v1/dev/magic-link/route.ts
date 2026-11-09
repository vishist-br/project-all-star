import { prisma } from "@/lib/db";
import { ApiError, errorResponse } from "@/lib/auth/errors";
import { readJsonObject, requireString } from "@/lib/auth/http";
import { createMagicLink } from "@/lib/auth/magic-link";

export const dynamic = "force-dynamic";

/**
 * DEV ONLY (not in the public contract): generate a magic link for a seeded user.
 * Disabled in production, where it answers 404. The link is returned and logged here only;
 * nothing is sent over WhatsApp or SMS.
 */
export async function POST(request: Request) {
  try {
    if (process.env.NODE_ENV === "production") throw new ApiError("not_found", "Not found");
    const body = await readJsonObject(request);
    const tenant = await prisma.tenant.findUnique({ where: { slug: requireString(body, "tenantSlug") } });
    const user = tenant
      ? await prisma.user.findFirst({ where: { tenantId: tenant.id, email: requireString(body, "email") } })
      : null;
    if (!tenant || !user) throw new ApiError("not_found", "User not found");
    const link = await createMagicLink(user.id, tenant.id);
    console.info(`[dev] magic link for ${user.email}: ${link.url}`);
    return Response.json({ url: link.url, expiresAt: link.expiresAt.toISOString() });
  } catch (err) {
    return errorResponse(err);
  }
}
