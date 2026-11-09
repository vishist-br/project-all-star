import type { Role as DbRole } from "@prisma/client";
import { ROLES, isRole, type Role } from "../nav";

/** The fixed three-way hierarchy. Exactly three roles; the DB enum mirrors this. */
export { ROLES, isRole };
export type ApiRole = Role;

export function toApiRole(role: DbRole): ApiRole {
  switch (role) {
    case "OWNER":
      return "owner";
    case "COACH":
      return "coach";
    case "CUSTOMER":
      return "customer";
  }
}

export function toDbRole(role: ApiRole): DbRole {
  return role.toUpperCase() as DbRole;
}
