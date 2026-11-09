import type { MessageKey } from "./i18n";

export type Role = "owner" | "coach" | "customer";
export const ROLES: readonly Role[] = ["owner", "coach", "customer"];

export function isRole(v: unknown): v is Role {
  return typeof v === "string" && (ROLES as readonly string[]).includes(v);
}

export type NavItem = { section: string; label: MessageKey; icon: string };

/** Navigation differs per role. Max 5 items so the mobile bottom bar stays tappable. */
export const NAV: Record<Role, readonly NavItem[]> = {
  owner: [
    { section: "dashboard", label: "nav.dashboard", icon: "▦" },
    { section: "members", label: "nav.members", icon: "☺" },
    { section: "batches", label: "nav.batches", icon: "◷" },
    { section: "coaches", label: "nav.coaches", icon: "★" },
    { section: "settings", label: "nav.settings", icon: "⚙" },
  ],
  coach: [
    { section: "today", label: "nav.today", icon: "◷" },
    { section: "members", label: "nav.members", icon: "☺" },
    { section: "record", label: "nav.myRecord", icon: "✓" },
  ],
  customer: [
    { section: "progress", label: "nav.progress", icon: "▲" },
    { section: "schedule", label: "nav.schedule", icon: "◷" },
    { section: "profile", label: "nav.profile", icon: "☺" },
  ],
};

export function findNavItem(role: Role, section: string): NavItem | undefined {
  return NAV[role].find((i) => i.section === section);
}
