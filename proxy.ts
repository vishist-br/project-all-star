import { NextResponse, type NextRequest } from "next/server";
import { isOpenPoc, ROUTE_ROLE_HEADER } from "@/lib/demo";
import { ACCESS_COOKIE, REFRESH_COOKIE, setAuthCookies, type TokenPair } from "@/lib/auth-cookies";

/** Same-origin bridge routes that belong to one role. */
const BRIDGE_ROLES: Record<string, string> = { "members-import": "owner", "workout-log": "customer" };

/**
 * Access-token refresh. The access cookie expires with the token. When it is gone but a refresh
 * cookie is present, call POST /api/v1/auth/refresh, store the rotated pair in httpOnly cookies
 * and let this same request see them. If the refresh fails the cookies are left alone (the
 * refresh token rotates, so a parallel request may have just used it) and the visitor is
 * treated as signed out for this request.
 */
export async function proxy(request: NextRequest) {
  if (isOpenPoc()) {
    // Open POC mode: no sign-in. The URL decides which role's screens render.
    const first = request.nextUrl.pathname.split("/")[1];
    const role = BRIDGE_ROLES[first === "ui" ? request.nextUrl.pathname.split("/")[2] : ""] ?? first;
    const headers = new Headers(request.headers);
    headers.delete(ROUTE_ROLE_HEADER);
    if (role === "owner" || role === "coach" || role === "customer") headers.set(ROUTE_ROLE_HEADER, role);
    return NextResponse.next({ request: { headers } });
  }
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
