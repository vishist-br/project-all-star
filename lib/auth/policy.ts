import type { ApiRole } from "./roles";

export type RoleRule = readonly ApiRole[] | "public";

/**
 * Allowed roles per operationId. Mirrors `x-roles` in docs/api/openapi.yaml;
 * tests/auth-policy.test.ts fails if the two drift apart.
 */
export const OPERATION_ROLES = {
  requestOtp: "public",
  verifyOtp: "public",
  exchangeMagicLink: "public",
  refreshSession: "public",
  signOut: ["owner", "coach", "customer"],
  getMe: ["owner", "coach", "customer"],
  getTenantTheme: "public",
  getCurrentTenant: ["owner", "coach", "customer"],
  updateTenantTheme: ["owner"],
  listMembers: ["owner", "coach"],
  getMember: ["owner", "coach", "customer"],
  createMemberMagicLink: ["owner", "coach"],
  importMembersCsv: ["owner"],
  listBatches: ["owner", "coach", "customer"],
  listSessions: ["owner", "coach", "customer"],
} as const satisfies Record<string, RoleRule>;

export type OperationId = keyof typeof OPERATION_ROLES;
