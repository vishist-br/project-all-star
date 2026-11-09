import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/auth/guard";
import { getThemeForTenant } from "@/lib/theme";

export const dynamic = "force-dynamic";

export const GET = withAuth("getCurrentTenant", async ({ principal }) => {
  const theme = await getThemeForTenant(prisma, principal.tenantId);
  // Timezone is not stored per tenant yet; venues carry it. Default for India.
  return Response.json({
    id: principal.tenantId,
    slug: theme.tenantSlug,
    timezone: "Asia/Kolkata",
    theme,
    showMissedSessionCost: false,
  });
});
