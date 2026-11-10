import { NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/auth-cookies";
import { errorResponse } from "@/lib/auth/errors";
import { readJsonObject, requireString } from "@/lib/auth/http";
import { exchangeMagicLink } from "@/lib/auth/magic-link";

export const dynamic = "force-dynamic";

/**
 * Same-origin step behind the /auth/magic landing page. It runs the magic-link exchange
 * (the same code as POST /api/v1/auth/magic-link/exchange) and stores the session in httpOnly
 * cookies, so the tokens never reach page scripts. The browser gets only the role to open.
 */
export async function POST(request: Request) {
  try {
    const token = requireString(await readJsonObject(request), "token");
    const { user, ...tokens } = await exchangeMagicLink(token);
    const res = NextResponse.json({ role: user.role, tenantSlug: user.tenantSlug });
    setAuthCookies(res.cookies, tokens);
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (err) {
    const res = errorResponse(err);
    res.headers.set("Cache-Control", "no-store");
    return res;
  }
}
