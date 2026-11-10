import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, REFRESH_COOKIE, setAuthCookies, type TokenPair } from "@/lib/auth-cookies";

/**
 * Access-token refresh. The access cookie expires with the token. When it is gone but a refresh
 * cookie is present, call POST /api/v1/auth/refresh, store the rotated pair in httpOnly cookies
 * and let this same request see them. If the refresh fails the cookies are left alone (the
 * refresh token rotates, so a parallel request may have just used it) and the visitor is
 * treated as signed out for this request.
 */
export async function proxy(request: NextRequest) {
  const refresh = request.cookies.get(REFRESH_COOKIE)?.value;
  if (request.cookies.get(ACCESS_COOKIE)?.value || !refresh) return NextResponse.next();
  try {
    const r = await fetch(new URL("/api/v1/auth/refresh", request.nextUrl.origin), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: refresh }),
      cache: "no-store",
    });
    if (!r.ok) return NextResponse.next();
    const tokens = (await r.json()) as TokenPair;
    request.cookies.set(ACCESS_COOKIE, tokens.accessToken);
    request.cookies.set(REFRESH_COOKIE, tokens.refreshToken);
    const res = NextResponse.next({ request });
    setAuthCookies(res.cookies, tokens);
    return res;
  } catch {
    return NextResponse.next();
  }
}

export const config = {
  matcher: ["/((?!api/|_next/|auth/|.*\\..*).*)"],
};
