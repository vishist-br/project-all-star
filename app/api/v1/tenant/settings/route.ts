import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/auth/guard";
import { readJsonObject } from "@/lib/auth/http";
import { getTenantProfile, updateTenantSettings } from "@/lib/api/tenant-settings";

export const dynamic = "force-dynamic";

export const PUT = withAuth("updateTenantSettings", async ({ principal, db }, request: Request) => {
  await updateTenantSettings(db, principal.tenantId, await readJsonObject(request));
  return Response.json(await getTenantProfile(prisma, db, principal.tenantId));
});
