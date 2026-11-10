import { cookies } from "next/headers";
import { ACCESS_COOKIE } from "@/lib/auth-cookies";
import { POST as apiPost } from "@/app/api/v1/members/import/route";

export const dynamic = "force-dynamic";

/**
 * Same-origin bridge for the import screen: the browser cannot read the httpOnly access cookie,
 * so this route adds it as the bearer token and hands the request to the real endpoint, which
 * enforces role and tenant exactly as for any other client.
 */
export async function POST(request: Request) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return Response.json({ code: "unauthorized", message: "Sign in first." }, { status: 401 });
  const headers = new Headers();
  const type = request.headers.get("content-type");
  const length = request.headers.get("content-length");
  if (type) headers.set("content-type", type);
  if (length) headers.set("content-length", length);
  headers.set("authorization", `Bearer ${token}`);
  const url = new URL(request.url);
  url.pathname = "/api/v1/members/import";
  return apiPost(new Request(url, { method: "POST", headers, body: await request.arrayBuffer() }));
}
