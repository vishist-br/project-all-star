// Cookie names and options for the browser session. Safe to import from route handlers and proxy.
// The tokens live only in httpOnly cookies: page scripts cannot read them, and they are never
// placed in localStorage or in a URL.
export const ACCESS_COOKIE = "as_access";
export const REFRESH_COOKIE = "as_refresh";
export const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

export function authCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

export type TokenPair = { accessToken: string; refreshToken: string; expiresInSeconds: number };

/** The access cookie lives exactly as long as the token, so an expired token simply disappears. */
export function setAuthCookies(
  jar: { set(name: string, value: string, opts: ReturnType<typeof authCookieOptions>): unknown },
  t: TokenPair,
) {
  jar.set(ACCESS_COOKIE, t.accessToken, authCookieOptions(t.expiresInSeconds));
  jar.set(REFRESH_COOKIE, t.refreshToken, authCookieOptions(REFRESH_TTL_SECONDS));
}
