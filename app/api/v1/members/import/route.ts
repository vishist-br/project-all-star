import { withAuth } from "@/lib/auth/guard";
import { ApiError } from "@/lib/auth/errors";
import { MAX_FILE_BYTES } from "@/lib/import/types";
import { assertCsvUpload, importMembers } from "@/lib/import/server";

export const dynamic = "force-dynamic";

/** POST /members/import: owner only, caller's tenant only (tenant comes from the session). */
export const POST = withAuth("importMembersCsv", async ({ principal, db }, request) => {
  const param = new URL(request.url).searchParams.get("dryRun");
  if (param !== null && param !== "true" && param !== "false") {
    throw new ApiError("validation_failed", "dryRun must be true or false.");
  }
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
  return Response.json(await importMembers(db, principal.tenantId, text, dryRun));
});
