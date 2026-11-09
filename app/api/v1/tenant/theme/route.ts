import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/auth/guard";
import { readJsonObject } from "@/lib/auth/http";
import { parseThemeInput, updateTheme } from "@/lib/theme";

export const dynamic = "force-dynamic";

export const PUT = withAuth("updateTenantTheme", async ({ principal }, request) => {
  const input = parseThemeInput(await readJsonObject(request));
  return Response.json(await updateTheme(prisma, principal.tenantId, input));
});
