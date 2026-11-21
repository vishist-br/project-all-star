import { revalidatePath } from "next/cache";
import { ApiError, errorResponse } from "@/lib/auth/errors";
import { checkRole } from "@/lib/auth/guard";
import { MAX_FILE_BYTES } from "@/lib/import/types";
import { assertCsvUpload, importMembers } from "@/lib/import/server";
import { getSessionOrNull } from "@/lib/session";
import { getViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

/**
 * Same-origin bridge for the owner import screen, in every mode. It resolves the viewer on the
 * server (the real session, or the seeded owner of the chosen demo business in demo mode), checks
 * the role like the real endpoint (importMembersCsv: owner only) and runs the same importMembers()
 * as POST /api/v1/members/import with the viewer's tenant-scoped client. The browser never sees a
 * token, and the tenant always comes from the session, never from the request.
 */
export async function POST(request: Request) {
  try {
    if (!(await getSessionOrNull())) throw new ApiError("unauthorized", "Sign in first.");
    const { principal, db } = await getViewer().catch(() => {
      throw new ApiError("unauthorized", "Sign in first.");
    });
    checkRole(principal, "importMembersCsv");

    const param = new URL(request.url).searchParams.get("dryRun");
    if (param !== null && param !== "true" && param !== "false") throw new ApiError("validation_failed", "dryRun must be true or false.");
    const dryRun = param !== "false"; // contract default is true
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > MAX_FILE_BYTES + 64 * 1024) throw new ApiError("payload_too_large", "File is larger than 2 MB.");

    let file: FormDataEntryValue | null;
    try {
      file = (await request.formData()).get("file");
    } catch {
      throw new ApiError("validation_failed", "Send the CSV as multipart/form-data with a file field.");
    }
    if (!(file instanceof File)) throw new ApiError("validation_failed", 'Missing "file" field.');
    const text = await file.text();
    assertCsvUpload(file, text);
    const result = await importMembers(db, principal.tenantId, text, dryRun);
    if (!dryRun && (result.importedRows ?? 0) > 0) revalidatePath("/[role]/[section]", "page");
    return Response.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
