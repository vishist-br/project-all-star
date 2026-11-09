import { errorResponse } from "@/lib/auth/errors";
import { readJsonObject, requireString } from "@/lib/auth/http";
import { exchangeMagicLink } from "@/lib/auth/magic-link";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const token = requireString(await readJsonObject(request), "token");
    return Response.json(await exchangeMagicLink(token));
  } catch (err) {
    return errorResponse(err);
  }
}
