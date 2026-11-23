/**
 * STAR-93: query-count budget per key page, against the seeded rich demo DB. A page is rendered
 * the way the server does it (root layout, role layout, app shell, page, async child components)
 * with next/headers faked as open POC mode (the URL decides the role) and React's request cache
 * emulated, while every Prisma query is counted. A regression that adds an N+1 or a duplicate
 * fetch pushes a page over its budget and fails CI. Budgets are the measured count plus about
 * 20 percent headroom: tighten them when a page gets cheaper, never loosen them silently.
 * QB_DEBUG=1 prints every query, to find what a failing page added.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, isValidElement, type ComponentType, type ReactNode } from "react";

const h = vi.hoisted(() => {
  process.env.POC_OPEN = "true";
  return { queries: 0, role: "owner", memos: [] as Map<string, unknown>[] };
});

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (k === "demo_tenant" ? { value: "demo-gym" } : undefined) }),
  headers: async () => ({ get: (k: string) => (k === "x-route-role" ? h.role : null) }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));
vi.mock("react", async (orig) => {
  const actual = await orig<typeof import("react")>();
  // Per-request memoisation like the server's cache(); cleared before every page.
  const cache = <A extends unknown[], R>(fn: (...a: A) => R) => {
    const memo = new Map<string, unknown>();
    h.memos.push(memo);
    return (...args: A): R => {
      const k = JSON.stringify(args);
      if (!memo.has(k)) memo.set(k, fn(...args));
      return memo.get(k) as R;
    };
  };
  return { ...actual, default: { ...actual, cache }, cache };
});
// Cold cache: count the queries a first (uncached) request pays.
vi.mock("next/cache", () => ({ unstable_cache: <F>(fn: F) => fn }));
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const client = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
  client.$on("query", (e) => {
    h.queries += 1;
    if (process.env.QB_DEBUG) console.log("Q", e.query.replace(/\s+/g, " ").slice(0, 110));
  });
  return { prisma: client };
});

type El = { type: unknown; props: Record<string, unknown> };

/** Runs async (and sync) server components down the tree so their queries execute. */
async function render(node: unknown, depth = 0): Promise<void> {
  if (node == null || typeof node !== "object" || depth > 40) return;
  if (Array.isArray(node)) {
    for (const n of node) await render(n, depth + 1);
    return;
  }
  if (!isValidElement(node)) return;
  const { type, props } = node as unknown as El;
  // Only async components are server components that fetch; sync ones (client components with hooks)
  // are not run, but their children are still walked.
  if (typeof type === "function" && (type as { constructor: { name: string } }).constructor.name === "AsyncFunction") {
    await render(await (type as (p: unknown) => unknown)(props), depth + 1);
    return;
  }
  await render(props.children, depth + 1);
}

type PageFn = ComponentType<{ params: Promise<{ role: string }>; searchParams: Promise<Record<string, string>> }>;
type PageMod = { default: PageFn };

const PAGES: { name: string; role: "owner" | "coach" | "customer"; load: () => Promise<PageMod>; budget: number }[] = [
  { name: "owner dashboard", role: "owner", load: () => import("../app/[role]/dashboard/page") as unknown as Promise<PageMod>, budget: 48 },
  { name: "owner members", role: "owner", load: () => import("../app/[role]/members/page") as unknown as Promise<PageMod>, budget: 30 },
  { name: "owner workouts", role: "owner", load: () => import("../app/[role]/workouts/page") as unknown as Promise<PageMod>, budget: 10 },
  { name: "coach today", role: "coach", load: () => import("../app/[role]/today/page") as unknown as Promise<PageMod>, budget: 26 },
  { name: "coach members", role: "coach", load: () => import("../app/[role]/members/page") as unknown as Promise<PageMod>, budget: 30 },
  { name: "customer home", role: "customer", load: () => import("../app/[role]/home/page") as unknown as Promise<PageMod>, budget: 60 },
  { name: "customer workouts", role: "customer", load: () => import("../app/[role]/workouts/page") as unknown as Promise<PageMod>, budget: 50 },
];

let ready = false;
beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    console.warn("[skip] DATABASE_URL is not set; query budgets need the seeded demo database.");
    return;
  }
  const { prisma } = await import("../lib/db");
  try {
    ready = (await prisma.tenant.count({ where: { slug: "demo-gym" } })) === 1;
  } catch {
    console.warn("[skip] Database unreachable or not migrated; query budgets not checked.");
  }
  if (!ready) console.warn("[skip] demo-gym is not seeded; run `npm run db:seed`.");
});
afterAll(async () => {
  if (ready) await (await import("../lib/db")).prisma.$disconnect();
});
beforeEach(() => {
  for (const m of h.memos) m.clear();
});

describe("query-count budget per page (STAR-93)", () => {
  for (const pg of PAGES) {
    it(`${pg.name} stays within ${pg.budget} queries`, async () => {
      if (!ready) return;
      h.role = pg.role;
      const [{ default: Root }, { default: RoleLayout }, page] = await Promise.all([
        import("../app/layout"),
        import("../app/[role]/layout"),
        pg.load(),
      ]);
      const params = Promise.resolve({ role: pg.role });
      h.queries = 0;
      const pageEl = createElement(page.default, { params, searchParams: Promise.resolve({}) });
      const tree = await RoleLayout({ children: pageEl, params });
      const root = await Root({ children: tree as ReactNode });
      await render(root);
      console.log(`QB ${pg.role} ${pg.name}: ${h.queries} queries (budget ${pg.budget})`);
      expect(h.queries, `${pg.name} ran no queries, the harness is not rendering it`).toBeGreaterThan(3);
      expect(h.queries, `${pg.name} used ${h.queries} queries, budget ${pg.budget}`).toBeLessThanOrEqual(pg.budget);
    }, 60_000);
  }
});
