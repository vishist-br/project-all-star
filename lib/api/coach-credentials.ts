import { ApiError } from "../auth/errors";
import { batchWhere } from "../auth/access";
import type { Principal } from "../auth/principal";
import type { TenantClient } from "../tenant-scope";
import { Problems } from "../workouts/validate";

/**
 * Coach credential badges (STAR-97, Coach Insight Directory). A coach claims a credential (title,
 * optional issuer and year); it shows as unverified until the owner marks it verified. Verification
 * is a visibility label for members and owners, nothing more.
 */
export type CredentialDto = {
  id: string;
  coachId: string;
  title: string;
  issuer: string | null;
  year: number | null;
  verified: boolean;
  verifiedAt: string | null;
};

export const TITLE_MAX = 80;
export const ISSUER_MAX = 80;
export const YEAR_MIN = 1970;
export const MAX_PER_COACH = 20;

type Row = { id: string; coachId: string; title: string; issuer: string | null; year: number | null; verifiedAt: Date | null };

export const toCredentialDto = (r: Row): CredentialDto => ({
  id: r.id,
  coachId: r.coachId,
  title: r.title,
  issuer: r.issuer,
  year: r.year,
  verified: r.verifiedAt !== null,
  verifiedAt: r.verifiedAt ? r.verifiedAt.toISOString() : null,
});

const select = { id: true, coachId: true, title: true, issuer: true, year: true, verifiedAt: true } as const;

/** Credentials of several coaches in one query (owner coach screens, member coach info). */
export async function credentialsByCoach(db: TenantClient, coachIds: string[]): Promise<Map<string, CredentialDto[]>> {
  const out = new Map<string, CredentialDto[]>();
  if (coachIds.length === 0) return out;
  const rows = await db.coachCredential.findMany({ where: { coachId: { in: coachIds } }, select, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  for (const r of rows) out.set(r.coachId, [...(out.get(r.coachId) ?? []), toCredentialDto(r)]);
  return out;
}

/** 404 outside the tenant (or not a coach); 403 for another coach, or a customer whose members the coach does not teach. */
async function assertCoachVisible(db: TenantClient, p: Principal, coachId: string) {
  const coach = await db.user.findFirst({ where: { id: coachId, role: "COACH" }, select: { id: true } });
  if (!coach) throw new ApiError("not_found", "Coach not found");
  if (p.role === "coach" && coachId !== p.userId) throw new ApiError("forbidden", "Coaches can only see their own credentials");
  if (p.role === "customer") {
    const teaches = await db.batch.findFirst({ where: { AND: [{ coachId }, batchWhere(p)] }, select: { id: true } });
    if (!teaches) throw new ApiError("forbidden", "This coach does not teach your members");
  }
}

/** GET /coaches/{coachId}/credentials (listCoachCredentials). */
export async function listCoachCredentials(db: TenantClient, p: Principal, coachId: string) {
  await assertCoachVisible(db, p, coachId);
  return { coachId, items: (await credentialsByCoach(db, [coachId])).get(coachId) ?? [] };
}

/** Coaches that teach the customer's members, with their credentials (member-facing coach info). */
export async function listMyCoachesWithCredentials(db: TenantClient, p: Principal) {
  const batches = await db.batch.findMany({ where: batchWhere(p), select: { coach: { select: { id: true, name: true } } } });
  const coaches = new Map(batches.map((b) => [b.coach.id, b.coach.name]));
  const creds = await credentialsByCoach(db, [...coaches.keys()]);
  return [...coaches]
    .sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]))
    .map(([id, name]) => ({ coachId: id, name, credentials: creds.get(id) ?? [] }));
}

function optionalText(p: Problems, body: Record<string, unknown>, field: string, max: number): string | null {
  const v = body[field];
  if (v === undefined || v === null) return null;
  const t = typeof v === "string" ? v.trim() : v;
  if (typeof t !== "string" || t.length > max) {
    p.add(field, `Text up to ${max} characters`);
    return null;
  }
  return t === "" ? null : t;
}

/** POST /coaches/{coachId}/credentials (createCoachCredential): owner or the coach; always starts unverified. */
export async function createCoachCredential(
  db: TenantClient,
  p: Principal,
  coachId: string,
  body: Record<string, unknown>,
  now = new Date(),
): Promise<CredentialDto> {
  await assertCoachVisible(db, p, coachId);
  const pr = new Problems();
  for (const k of Object.keys(body)) if (!["title", "issuer", "year"].includes(k)) pr.add(k, "unknown field");
  const title = typeof body.title === "string" ? body.title.trim() : body.title;
  if (typeof title !== "string" || title.length < 1 || title.length > TITLE_MAX) pr.add("title", `Text 1..${TITLE_MAX} characters`);
  const issuer = optionalText(pr, body, "issuer", ISSUER_MAX);
  let year: number | null = null;
  if (body.year !== undefined && body.year !== null) {
    const y = body.year;
    if (typeof y !== "number" || !Number.isInteger(y) || y < YEAR_MIN || y > now.getUTCFullYear()) pr.add("year", `Year ${YEAR_MIN}..${now.getUTCFullYear()}`);
    else year = y;
  }
  pr.throwIfAny();
  if ((await db.coachCredential.count({ where: { coachId } })) >= MAX_PER_COACH) {
    throw new ApiError("conflict", `A coach can list at most ${MAX_PER_COACH} credentials`);
  }
  const row = await db.coachCredential.create({ data: { tenantId: p.tenantId, coachId, title: title as string, issuer, year }, select });
  return toCredentialDto(row);
}

/** PATCH /coach-credentials/{credentialId} (setCoachCredentialVerification): owner only. 404 outside the tenant. */
export async function setCoachCredentialVerification(
  db: TenantClient,
  p: Principal,
  credentialId: string,
  body: Record<string, unknown>,
  now = new Date(),
): Promise<CredentialDto> {
  const pr = new Problems();
  for (const k of Object.keys(body)) if (k !== "verified") pr.add(k, "unknown field");
  if (typeof body.verified !== "boolean") pr.add("verified", "Boolean required");
  pr.throwIfAny();
  const row = await db.coachCredential.findFirst({ where: { id: credentialId }, select: { id: true } });
  if (!row) throw new ApiError("not_found", "Credential not found");
  const verified = body.verified as boolean;
  await db.coachCredential.updateMany({
    where: { id: credentialId },
    data: verified ? { verifiedAt: now, verifiedById: p.userId } : { verifiedAt: null, verifiedById: null },
  });
  return toCredentialDto(await db.coachCredential.findFirstOrThrow({ where: { id: credentialId }, select }));
}

/** DELETE /coach-credentials/{credentialId} (deleteCoachCredential): owner, or the coach for their own. */
export async function deleteCoachCredential(db: TenantClient, p: Principal, credentialId: string): Promise<void> {
  const row = await db.coachCredential.findFirst({ where: { id: credentialId }, select: { id: true, coachId: true } });
  if (!row) throw new ApiError("not_found", "Credential not found");
  if (p.role === "coach" && row.coachId !== p.userId) throw new ApiError("forbidden", "Coaches can only remove their own credentials");
  await db.coachCredential.deleteMany({ where: { id: credentialId } });
}
