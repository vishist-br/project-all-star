import type { MessageKey } from "./i18n";

export type Role = "owner" | "coach" | "customer";
export const ROLES: readonly Role[] = ["owner", "coach", "customer"];

export function isRole(v: unknown): v is Role {
  return typeof v === "string" && (ROLES as readonly string[]).includes(v);
}

/**
 * `bar` items sit in the phone's bottom bar (max 4, the fifth slot is "More"). Every item shows in the
 * side rail from 768px, and the More page lists them all, so no screen is reachable only by a link.
 */
export type NavItem = { section: string; label: MessageKey; icon: string; bar?: boolean };

export const MAX_BAR_ITEMS = 4;

export const NAV: Record<Role, readonly NavItem[]> = {
  owner: [
    { section: "dashboard", label: "nav.dashboard", icon: "▦", bar: true },
    { section: "members", label: "nav.members", icon: "☺", bar: true },
    { section: "members/import", label: "nav.import", icon: "⇪" },
    { section: "batches", label: "nav.batches", icon: "◷", bar: true },
    { section: "coaches", label: "nav.coaches", icon: "★" },
    { section: "plans", label: "nav.plans", icon: "☰" },
    { section: "insights", label: "nav.insights", icon: "◈" },
    { section: "workouts", label: "nav.workouts", icon: "✚" },
    { section: "holidays", label: "nav.holidays", icon: "☀" },
    { section: "settings", label: "nav.settings", icon: "⚙", bar: true },
  ],
  coach: [
    { section: "today", label: "nav.today", icon: "◷", bar: true },
    { section: "today/week", label: "nav.week", icon: "▤" },
    { section: "today/availability", label: "nav.availability", icon: "◔" },
    { section: "members", label: "nav.members", icon: "☺", bar: true },
    { section: "plans", label: "nav.plans", icon: "☰", bar: true },
    { section: "workouts", label: "nav.workouts", icon: "✚" },
    { section: "record", label: "nav.myRecord", icon: "✓", bar: true },
  ],
  customer: [
    { section: "home", label: "nav.home", icon: "⌂", bar: true },
    { section: "workouts", label: "nav.workouts", icon: "✚", bar: true },
    { section: "workouts/live", label: "nav.liveWorkout", icon: "▶" },
    { section: "schedule", label: "nav.schedule", icon: "◷", bar: true },
    { section: "progress", label: "nav.progress", icon: "▲", bar: true },
    { section: "progress/week", label: "nav.weeklyCard", icon: "▤" },
    { section: "progress/exercises", label: "nav.exercises", icon: "☰" },
    { section: "progress/skills", label: "nav.skills", icon: "◆" },
    { section: "progress/body", label: "nav.body", icon: "◎" },
    { section: "progress/muscles", label: "nav.muscles", icon: "◈" },
    { section: "classes", label: "nav.classes", icon: "◐" },
    { section: "updates", label: "nav.updates", icon: "✉" },
    { section: "absences", label: "nav.absences", icon: "✎" },
    { section: "profile", label: "nav.profile", icon: "☺" },
  ],
};

export function findNavItem(role: Role, section: string): NavItem | undefined {
  return NAV[role].find((i) => i.section === section);
}
