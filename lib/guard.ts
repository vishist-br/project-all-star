import type { Role } from "./nav";

/** A signed-in user may open only their own role's screens. */
export function canViewRole(sessionRole: Role, routeRole: Role): boolean {
  return sessionRole === routeRole;
}

export function homePath(role: Role): string {
  return `/${role}`;
}
