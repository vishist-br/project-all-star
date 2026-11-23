import { withAuth } from "@/lib/auth/guard";
import { readJsonObject } from "@/lib/auth/http";
import { deleteCoachCredential, setCoachCredentialVerification } from "@/lib/api/coach-credentials";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ credentialId: string }> };

export const PATCH = withAuth("setCoachCredentialVerification", async ({ principal, db }, request: Request, { params }: Ctx) =>
  Response.json(await setCoachCredentialVerification(db, principal, (await params).credentialId, await readJsonObject(request))),
);

export const DELETE = withAuth("deleteCoachCredential", async ({ principal, db }, _request: Request, { params }: Ctx) => {
  await deleteCoachCredential(db, principal, (await params).credentialId);
  return new Response(null, { status: 204 });
});
