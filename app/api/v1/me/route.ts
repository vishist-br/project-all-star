import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/auth/errors";
import { withAuth } from "@/lib/auth/guard";
import { buildMe } from "@/lib/auth/me";

export const dynamic = "force-dynamic";

export const GET = withAuth("getMe", async ({ principal }) => {
  const me = await buildMe(prisma, principal.tenantId, principal.userId);
  if (!me) throw new ApiError("unauthorized", "Missing, expired or invalid credentials");
  return Response.json(me);
});
