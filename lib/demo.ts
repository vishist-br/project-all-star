// Cookie names and constants shared by server and client (lib/session.ts imports next/headers, so keep these separate).
export const DEMO_TENANT_COOKIE = "demo_tenant";
export const DEMO_ROLE_COOKIE = "demo_role";

/** Slugs of the seeded demo tenants (prisma/seed). Names, logos and colours come from the database. */
export const DEMO_TENANT_SLUGS = ["demo-karate", "demo-gym", "demo-studio"] as const;

/** Display names for the demo role picker only. Real sessions use the user's name from the database. */
export const DEMO_USER_NAMES = {
  owner: "Demo Owner",
  coach: "Demo Coach",
  customer: "Demo Member",
} as const;
