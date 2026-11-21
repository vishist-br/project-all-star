import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/auth/guard";
import { getTenantProfile } from "@/lib/api/tenant-settings";

export const dynamic = "force-dynamic";

export const GET = withAuth("getCurrentTenant", async ({ principal, db }) =>
  Response.json(await getTenantProfile(prisma, db, principal.tenantId)),
);
