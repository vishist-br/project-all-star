import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "./db";
import { ACCESS_COOKIE } from "./auth-cookies";
import { buildMe } from "./auth/me";
import { resolvePrincipal } from "./auth/session";
import { DEMO_ROLE_COOKIE, DEMO_TENANT_COOKIE, DEMO_TENANT_SLUGS, DEMO_USER_NAMES } from "./demo";
import { isRole, type Role } from "./nav";
import { getThemeBySlug, getThemeForTenant } from "./theme";
import { NEUTRAL_THEME, type UiTheme } from "./theme-ui";

/**
 * Single seam for "who is signed in". Real session first: the httpOnly access cookie is resolved
 * like GET /me (user, role, tenant) and the tenant theme like GET /tenants/{slug}/theme, straight
 * from the database. Only when there is no real session, and only in demo mode, the demo
 * switcher cookies pick a seeded tenant (theme from the database) and a role.
 * Nothing else in the UI reads cookies or tenant data directly.
 */
export type Session = {
  role: Role;
  name: string;
  tenantSlug: string;
  theme: UiTheme;
  /** "real" = signed in by magic link; "demo" = the dev/demo switcher. */
  source: "real" | "demo";
};

/** Demo switcher is shown only outside production, or when DEMO_MODE=true. */
export function isDemoMode(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.DEMO_MODE === "true";
}

function toUiTheme(t: UiTheme): UiTheme {
  return {
    tenantSlug: t.tenantSlug,
    displayName: t.displayName,
    logoUrl: t.logoUrl,
    primaryColor: t.primaryColor,
    secondaryColor: t.secondaryColor,
    accentColor: t.accentColor,
  };
}

async function realSession(accessToken: string): Promise<Session | null> {
  const principal = await resolvePrincipal(
    new Request("http://internal.invalid/", { headers: { authorization: `Bearer ${accessToken}` } }),
  );
  if (!principal) return null;
  const me = await buildMe(prisma, principal.tenantId, principal.userId);
  if (!me) return null;
  const theme = toUiTheme(await getThemeForTenant(prisma, principal.tenantId));
  return { role: me.role, name: me.name, tenantSlug: me.tenantSlug, theme, source: "real" };
}

async function demoSession(): Promise<Session> {
  const jar = await cookies();
  const wanted = jar.get(DEMO_TENANT_COOKIE)?.value;
  const slug = DEMO_TENANT_SLUGS.find((s) => s === wanted) ?? DEMO_TENANT_SLUGS[0];
  const roleCookie = jar.get(DEMO_ROLE_COOKIE)?.value;
  const role: Role = isRole(roleCookie) ? roleCookie : "owner";
  const theme = toUiTheme(await getThemeBySlug(prisma, slug));
  return { role, name: DEMO_USER_NAMES[role], tenantSlug: slug, theme, source: "demo" };
}

/** The current session, or null when nobody is signed in and demo mode is off. Cached per request. */
export const getSessionOrNull = cache(async (): Promise<Session | null> => {
  const jar = await cookies();
  const access = jar.get(ACCESS_COOKIE)?.value;
  if (access) {
    const real = await realSession(access);
    if (real) return real;
  }
  return isDemoMode() ? demoSession() : null;
});

/** For screens that need a signed-in user: sends visitors without a session to the sign-in-needed page. */
export async function getSession(): Promise<Session> {
  const session = await getSessionOrNull();
  if (!session) redirect("/sign-in");
  return session;
}

/** Theme for pages that also render without a session (sign-in pages, footer): neutral, no business name. */
export async function getThemeOrNeutral(): Promise<UiTheme> {
  return (await getSessionOrNull())?.theme ?? NEUTRAL_THEME;
}

export type DemoTenantOption = { tenantSlug: string; displayName: string };

/** The seeded demo tenants, with their real names, for the demo switcher. Tenants missing from the database are skipped. */
export async function listDemoTenants(): Promise<DemoTenantOption[]> {
  const rows = await prisma.tenant.findMany({ where: { slug: { in: [...DEMO_TENANT_SLUGS] } } });
  return DEMO_TENANT_SLUGS.flatMap((slug) => {
    const row = rows.find((r) => r.slug === slug);
    return row ? [{ tenantSlug: slug, displayName: row.name }] : [];
  });
}
