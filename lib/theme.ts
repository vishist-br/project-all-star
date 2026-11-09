import type { PrismaClient } from "@prisma/client";
import { ApiError, type ErrorDetail } from "./auth/errors";
import { forTenant } from "./tenant-scope";

export const DEFAULT_THEME = { primaryColor: "#1F6FEB", secondaryColor: "#0B1F3A" } as const;
export const LOCALES = ["en", "hi", "kn"] as const;
export type Locale = (typeof LOCALES)[number];

export type TenantTheme = {
  tenantSlug: string;
  displayName: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string | null;
  defaultLocale: Locale;
};

export type ThemeWarning = { field: string; code: "low_contrast"; message: string };
export type ThemeWithWarnings = TenantTheme & { warnings: ThemeWarning[] };

const HEX = /^#[0-9A-Fa-f]{6}$/;
/** WCAG AA for normal text. */
export const MIN_CONTRAST = 4.5;

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Primary and secondary are used as backgrounds with white text; warn when that is hard to read. */
export function contrastWarnings(t: { primaryColor: string; secondaryColor: string }): ThemeWarning[] {
  const out: ThemeWarning[] = [];
  for (const field of ["primaryColor", "secondaryColor"] as const) {
    const ratio = contrastRatio(t[field], "#FFFFFF");
    if (ratio < MIN_CONTRAST) {
      out.push({
        field,
        code: "low_contrast",
        message: `White text on ${t[field]} has a contrast ratio of ${ratio.toFixed(2)}:1; at least ${MIN_CONTRAST}:1 is recommended.`,
      });
    }
  }
  return out;
}

export type ThemeInput = {
  displayName: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string | null;
  defaultLocale: Locale | undefined;
};

/** Validate the PUT body. Throws validation_failed listing every bad field. */
export function parseThemeInput(body: Record<string, unknown>): ThemeInput {
  const errors: ErrorDetail[] = [];
  const bad = (field: string, message: string) => errors.push({ field, message });

  const rawName = body.displayName;
  const displayName = typeof rawName === "string" ? rawName.trim() : "";
  if (displayName.length < 1 || displayName.length > 80) bad("displayName", "Required, 1 to 80 characters");

  const color = (field: string, required: boolean): string | null => {
    const v = body[field];
    if (v === undefined || v === null) {
      if (required) bad(field, "Required hex color like #1F6FEB");
      return null;
    }
    if (typeof v !== "string" || !HEX.test(v)) {
      bad(field, "Must be a hex color like #1F6FEB");
      return null;
    }
    return v.toUpperCase();
  };
  const primaryColor = color("primaryColor", true);
  const secondaryColor = color("secondaryColor", true);
  const accentColor = color("accentColor", false);

  let logoUrl: string | null = null;
  const rawLogo = body.logoUrl;
  if (rawLogo !== undefined && rawLogo !== null) {
    try {
      if (typeof rawLogo !== "string" || rawLogo.length > 2048) throw new Error();
      const u = new URL(rawLogo);
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
      logoUrl = rawLogo;
    } catch {
      bad("logoUrl", "Must be an http(s) URL");
    }
  }

  let defaultLocale: Locale | undefined;
  if (body.defaultLocale !== undefined) {
    if (typeof body.defaultLocale === "string" && (LOCALES as readonly string[]).includes(body.defaultLocale)) {
      defaultLocale = body.defaultLocale as Locale;
    } else bad("defaultLocale", "Must be one of en, hi, kn");
  }

  if (errors.length) throw new ApiError("validation_failed", "Invalid theme", errors);
  return { displayName, logoUrl, primaryColor: primaryColor!, secondaryColor: secondaryColor!, accentColor, defaultLocale };
}

type Row = {
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string | null;
  defaultLocale: string;
} | null;

function compose(tenant: { slug: string; name: string }, row: Row): TenantTheme {
  return {
    tenantSlug: tenant.slug,
    displayName: tenant.name,
    logoUrl: row?.logoUrl ?? null,
    primaryColor: row?.primaryColor ?? DEFAULT_THEME.primaryColor,
    secondaryColor: row?.secondaryColor ?? DEFAULT_THEME.secondaryColor,
    accentColor: row?.accentColor ?? null,
    defaultLocale: (row?.defaultLocale as Locale | undefined) ?? "en",
  };
}

/** Public read by slug (for theming the sign-in page). 404 for an unknown slug. */
export async function getThemeBySlug(client: PrismaClient, slug: string): Promise<TenantTheme> {
  const tenant = await client.tenant.findUnique({ where: { slug } });
  if (!tenant) throw new ApiError("not_found", "Tenant not found");
  const row = await forTenant(client, tenant.id).tenantTheme.findFirst({});
  return compose(tenant, row);
}

export async function getThemeForTenant(client: PrismaClient, tenantId: string): Promise<TenantTheme> {
  const tenant = await client.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new ApiError("not_found", "Tenant not found");
  const row = await forTenant(client, tenantId).tenantTheme.findFirst({});
  return compose(tenant, row);
}

/** Owner update for the caller's own tenant. Returns the saved theme plus contrast warnings. */
export async function updateTheme(
  client: PrismaClient,
  tenantId: string,
  input: ThemeInput,
): Promise<ThemeWithWarnings> {
  const db = forTenant(client, tenantId);
  const data = {
    logoUrl: input.logoUrl,
    primaryColor: input.primaryColor,
    secondaryColor: input.secondaryColor,
    accentColor: input.accentColor,
    ...(input.defaultLocale ? { defaultLocale: input.defaultLocale } : {}),
  };
  // Tenant is the one global model (the display name lives there); the theme row is scoped.
  await db.tenantTheme.upsert({ where: { tenantId }, create: { tenantId, ...data }, update: data });
  await client.tenant.update({ where: { id: tenantId }, data: { name: input.displayName } });
  const theme = await getThemeForTenant(client, tenantId);
  return { ...theme, warnings: contrastWarnings(theme) };
}
