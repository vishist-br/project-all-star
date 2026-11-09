import { errorResponse } from "@/lib/auth/errors";
import { readJsonObject, requireString } from "@/lib/auth/http";
import { refreshSession } from "@/lib/auth/magic-link";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const token = requireString(await readJsonObject(request), "refreshToken");
    return Response.json(await refreshSession(token));
  } catch (err) {
    return errorResponse(err);
  }
}
