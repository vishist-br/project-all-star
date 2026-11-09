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

/** Three demo tenants with different branding (karate academy, gym, group classes). */
export const MOCK_TENANTS: readonly MockTheme[] = [
  {
    tenantSlug: "demo-karate",
    displayName: "Demo Karate Academy",
    logoUrl: "/demo-logos/karate.svg",
    primaryColor: "#b3261e",
    secondaryColor: "#2b0d0b",
    accentColor: "#f2c200",
  },
  {
    tenantSlug: "demo-gym",
    displayName: "Demo Iron Gym",
    logoUrl: "/demo-logos/gym.svg",
    primaryColor: "#0f766e",
    secondaryColor: "#0b2b29",
    accentColor: "#f97316",
  },
  {
    tenantSlug: "demo-classes",
    displayName: "Demo Group Classes Studio",
    logoUrl: "/demo-logos/classes.svg",
    primaryColor: "#6d28d9",
    secondaryColor: "#1e1038",
    accentColor: "#22c55e",
  },
];

export const DEFAULT_TENANT_SLUG = MOCK_TENANTS[0].tenantSlug;

export function resolveTheme(slug: string | undefined | null): MockTheme {
  return MOCK_TENANTS.find((t) => t.tenantSlug === slug) ?? MOCK_TENANTS[0];
}

export const MOCK_USERS: Record<Role, { name: string }> = {
  owner: { name: "Demo Owner" },
  coach: { name: "Demo Coach" },
  customer: { name: "Demo Member" },
};
