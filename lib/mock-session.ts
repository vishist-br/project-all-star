import type { Role } from "./nav";

// PLACEHOLDER data until auth and the tenant theme API (docs/api/openapi.yaml) are wired in.
// Shapes follow the TenantTheme and /me schemas. Fake names only.
export type MockTheme = {
  tenantSlug: string;
  displayName: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string | null;
};

export const MOCK_THEME: MockTheme = {
  tenantSlug: "demo-academy",
  displayName: "Demo Academy",
  logoUrl: null,
  primaryColor: "#1f6feb",
  secondaryColor: "#0b1f3a",
  accentColor: "#f2a900",
};

export const MOCK_USERS: Record<Role, { name: string }> = {
  owner: { name: "Demo Owner" },
  coach: { name: "Demo Coach" },
  customer: { name: "Demo Member" },
};
