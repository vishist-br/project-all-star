import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/lib/auth-cookies";
import { signOut } from "@/lib/auth/magic-link";

export const dynamic = "force-dynamic";

/** Sign-out form target: revokes the session (same code as POST /api/v1/auth/sign-out), clears cookies, goes to /sign-in. */
export async function POST(request: NextRequest) {
  const access = request.cookies.get(ACCESS_COOKIE)?.value;
  if (access) await signOut(access).catch(() => undefined);
  const res = new NextResponse(null, { status: 303, headers: { Location: "/sign-in", "Cache-Control": "no-store" } });
  res.cookies.delete(ACCESS_COOKIE);
  res.cookies.delete(REFRESH_COOKIE);
  return res;
}
