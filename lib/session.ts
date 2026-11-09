import { cookies } from "next/headers";
import { DEMO_ROLE_COOKIE, DEMO_TENANT_COOKIE } from "./demo";
import { MOCK_USERS, resolveTheme, type MockTheme } from "./mock-session";
import { isRole, type Role } from "./nav";

/**
 * Single seam for "who is signed in". Today it reads demo cookies and mock data.
 * To use real auth later, replace the body of getSession() with a call to GET /me
 * (Me schema) plus GET /tenants/{tenantSlug}/theme, keeping the Session shape.
 * Nothing else in the UI reads cookies or mock data directly.
 */
export type Session = {
  role: Role;
  name: string;
  tenantSlug: string;
  theme: MockTheme;
};

/** Demo switcher is shown only outside production, or when DEMO_MODE=true. */
export function isDemoMode(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.DEMO_MODE === "true";
}

export async function getSession(): Promise<Session> {
  const jar = await cookies();
  const demo = isDemoMode();
  const theme = resolveTheme(demo ? jar.get(DEMO_TENANT_COOKIE)?.value : undefined);
  const roleCookie = demo ? jar.get(DEMO_ROLE_COOKIE)?.value : undefined;
  const role: Role = isRole(roleCookie) ? roleCookie : "owner";
  return { role, name: MOCK_USERS[role].name, tenantSlug: theme.tenantSlug, theme };
}
