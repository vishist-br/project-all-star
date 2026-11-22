import { NAV, ROLES, type Role } from "../../lib/nav";

export const TENANT_SLUGS = ["demo-karate", "demo-gym", "demo-studio"] as const;
export { ROLES, type Role };

/** Static pages per role: every nav section plus the known sub-pages. Detail pages are discovered from links. */
export const SUB_PAGES: Record<Role, string[]> = {
  owner: ["", "members/import", "coaches", "updates-none"],
  coach: ["", "today/week", "today/availability", "plans/new", "sessions/new"],
  customer: ["", "updates"],
};

export function basePaths(role: Role): string[] {
  const nav = NAV[role].map((n) => `/${role}/${n.section}`);
  const extra = SUB_PAGES[role].filter((p) => p !== "updates-none").map((p) => `/${role}${p ? "/" + p : ""}`);
  const owner = role === "owner" ? ["/owner/coaches", "/owner/batches"] : [];
  return [...new Set([...extra, ...nav, ...owner])];
}

/** Detail routes found by following links from the base pages. */
export const DETAIL_PATTERNS = [
  /^\/(owner|coach|customer)\/members\/[^/?#]+$/,
  /^\/(owner|coach|customer)\/plans\/[^/?#]+$/,
  /^\/(owner|coach|customer)\/coaches\/[^/?#]+$/,
  /^\/(owner|coach|customer)\/sessions\/(?!new)[^/?#]+$/,
  /^\/(owner|coach|customer)\/exercise\/[^/?#]+$/,
];

export const PUBLIC_PATHS = ["/", "/about", "/sign-in"];

// ---- Wording rules --------------------------------------------------------------------------
export const PLACEHOLDER_RE = /real content arrives|placeholder|lorem|ipsum|\btodo\b|coming soon|\btbd\b|under construction|not implemented|\[object|\bundefined\b|\bNaN\b|Invalid Date|will be built in a later task/i;
export const SURVEILLANCE_RE = /accountab|surveil|spy\b|spying|snoop|watchdog|policing|punish|crack ?down|offender|defaulter|blacklist/i;
export const NEGATIVE_FRAMING_RE = /\b(worst|lazy|slacker|slacking|underperform\w*|poor performer|bad attendance|failing|failed (?:to attend)|delinquent|useless)\b/i;
export const BRANDING_RE = /project[\s-]*all[\s-]*star|allstar|all[\s-]star|claude|anthropic|vercel|next\.?js|neon\.tech|prisma|powered by/i;
export const STACK_TRACE_RE = /\bat\s+\S+\s+\(.*:\d+:\d+\)|Error:\s|digest|ECONNREFUSED|PrismaClient|Unhandled|Application error|Internal Server Error|node_modules/;
export const REAL_PERSON_RE = /@(?!(?:[a-z0-9-]+\.)*example\.(?:test|com|invalid)\b)[a-z0-9.-]+\.[a-z]{2,}/i;
export const PHONE_RE = /(?:\+?91[\s-]?)?\b[6-9]\d{4}[\s-]?\d{5}\b|\+\d{1,3}[\s-]\d{6,}/;
