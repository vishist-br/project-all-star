import { bearerToken } from "@/lib/auth/session";
import { withAuth } from "@/lib/auth/guard";
import { signOut } from "@/lib/auth/magic-link";

export const dynamic = "force-dynamic";

export const POST = withAuth("signOut", async (_ctx, request) => {
  const token = bearerToken(request);
  if (token) await signOut(token);
  return new Response(null, { status: 204 });
});
