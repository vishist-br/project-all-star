import type { CredentialDto } from "@/lib/api/coach-credentials";

export const TITLE_MAX = 80;
export const ISSUER_MAX = 80;
export const YEAR_MIN = 1970;

export type CredentialError = "titleRequired" | "titleLong" | "yearInvalid";

/** Same limits as createCoachCredential, so the form explains problems before the server does. */
export function validateCredential(input: { title: string; issuer: string; year: string }, thisYear: number):
  | { ok: true; value: { title: string; issuer?: string; year?: number } }
  | { ok: false; errors: Partial<Record<"title" | "year", CredentialError>> } {
  const errors: Partial<Record<"title" | "year", CredentialError>> = {};
  const title = input.title.trim();
  if (!title) errors.title = "titleRequired";
  else if (title.length > TITLE_MAX) errors.title = "titleLong";
  const yearText = input.year.trim();
  let year: number | undefined;
  if (yearText) {
    year = /^\d{4}$/.test(yearText) ? Number(yearText) : NaN;
    if (!(year >= YEAR_MIN && year <= thisYear)) errors.year = "yearInvalid";
  }
  if (errors.title || errors.year) return { ok: false, errors };
  const issuer = input.issuer.trim().slice(0, ISSUER_MAX);
  return { ok: true, value: { title, ...(issuer ? { issuer } : {}), ...(year !== undefined ? { year } : {}) } };
}

/** Verified first, then the rest in the order they were added. */
export function sortCredentials(items: CredentialDto[]): CredentialDto[] {
  return [...items].sort((a, b) => Number(b.verified) - Number(a.verified));
}

export function credentialCounts(items: CredentialDto[]) {
  const verified = items.filter((c) => c.verified).length;
  return { verified, unverified: items.length - verified };
}
