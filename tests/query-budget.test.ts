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
import { seedDemo } from "../prisma/seed/demo";
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
  const ids = new WeakMap<object, number>() as WeakMap<object, number> & { size: number };
  Object.defineProperty(ids, "size", { get: () => count, configurable: true });
  let count = 0;
  const origSet = ids.set.bind(ids);
  ids.set = (key, val) => (count++, origSet(key, val));
  const cache = <A extends unknown[], R>(fn: (...a: A) => R) => {
    const memo = new Map<string, unknown>();
    h.memos.push(memo);
    return (...args: A): R => {
      const k = JSON.stringify(args, (_k, v) => {
        // Objects such as a Prisma client are keyed by identity (React's cache does the same); plain data by value.
        if (v && typeof v === "object" && (v as { constructor?: { name?: string } }).constructor?.name !== "Object" && !Array.isArray(v)) {
          if (!ids.has(v)) ids.set(v, ids.size + 1);
          return `#obj${ids.get(v)}`;
        }
        return v;
      });
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

type PageFn = ComponentType<{ params: Promise<Record<string, string>>; searchParams: Promise<Record<string, string>> }>;
type PageMod = { default: PageFn };

// Ids of rows in the seeded demo tenant, for the pages that take a route segment (filled in beforeAll).
const ids = { planId: "", exerciseId: "" };

const PAGES: {
  name: string;
  role: "owner" | "coach" | "customer";
  load: () => Promise<PageMod>;
  budget: number;
  /** Extra route segments (a function, because the ids are read from the database first). */
  segments?: () => Record<string, string>;
  search?: Record<string, string>;
}[] = [
  { name: "owner dashboard", role: "owner", load: () => import("../app/[role]/dashboard/page") as unknown as Promise<PageMod>, budget: 75 },
  { name: "owner members", role: "owner", load: () => import("../app/[role]/members/page") as unknown as Promise<PageMod>, budget: 30 },
  { name: "owner workouts", role: "owner", load: () => import("../app/[role]/workouts/page") as unknown as Promise<PageMod>, budget: 10 },
  { name: "coach today", role: "coach", load: () => import("../app/[role]/today/page") as unknown as Promise<PageMod>, budget: 26 },
  { name: "coach members", role: "coach", load: () => import("../app/[role]/members/page") as unknown as Promise<PageMod>, budget: 30 },
  { name: "customer home", role: "customer", load: () => import("../app/[role]/home/page") as unknown as Promise<PageMod>, budget: 53 },
  { name: "customer workouts", role: "customer", load: () => import("../app/[role]/workouts/page") as unknown as Promise<PageMod>, budget: 46 },
  // STAR-102: the screens added after round 1.
  { name: "customer live workout", role: "customer", load: () => import("../app/[role]/workouts/live/page") as unknown as Promise<PageMod>, budget: 23 },
  { name: "customer classes", role: "customer", load: () => import("../app/[role]/classes/page") as unknown as Promise<PageMod>, budget: 14 },
  { name: "customer progress exercises", role: "customer", load: () => import("../app/[role]/progress/exercises/page") as unknown as Promise<PageMod>, budget: 18 },
  { name: "customer progress skills", role: "customer", load: () => import("../app/[role]/progress/skills/page") as unknown as Promise<PageMod>, budget: 15 },
  ...(["progress", "history", "howto"] as const).map((tab) => ({
    name: `customer exercise ${tab} tab`,
    role: "customer" as const,
    load: () => import("../app/[role]/exercise/[exerciseId]/page") as unknown as Promise<PageMod>,
    budget: 17,
    segments: () => ({ exerciseId: ids.exerciseId }),
    search: { tab },
  })),
  { name: "owner insights", role: "owner", load: () => import("../app/[role]/insights/page") as unknown as Promise<PageMod>, budget: 14 },
  { name: "owner plan results", role: "owner", load: () => import("../app/[role]/plans/[planId]/results/page") as unknown as Promise<PageMod>, budget: 20, segments: () => ({ planId: ids.planId }) },
  { name: "owner plan send", role: "owner", load: () => import("../app/[role]/plans/[planId]/send/page") as unknown as Promise<PageMod>, budget: 26, segments: () => ({ planId: ids.planId }) },
];

let ready = false;
let seeded = false;
beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    console.warn("[skip] DATABASE_URL is not set; query budgets need the seeded demo database.");
    return;
  }
  const { prisma } = await import("../lib/db");
  try {
    // Deterministic data: other test files leave the shared database on the base seed or with extra rows,
    // so lay down the rich seed here (idempotent) and put the base seed back afterwards, as they do.
    await seedDemo(prisma, { rich: true });
    seeded = true;
    ready = (await prisma.tenant.count({ where: { slug: "demo-gym" } })) === 1;
  } catch {
    console.warn("[skip] Database unreachable or not migrated; query budgets not checked.");
  }
  if (!ready) console.warn("[skip] demo-gym is not seeded; run `npm run db:seed`.");
  else {
    // A fixed seeded plan with assignments (the one the budgets were measured on).
    const plan = await prisma.workoutPlan.findFirst({
      where: { tenant: { slug: "demo-gym" }, id: "seed-demo-gym-r-we-plan-foundations", assignments: { some: {} } },
      select: { id: true, days: { select: { items: { select: { exerciseId: true }, take: 1 } }, take: 1 } },
    });
    ids.planId = plan?.id ?? "missing";
    ids.exerciseId = plan?.days[0]?.items[0]?.exerciseId ?? "missing";
  }
}, 120_000);
afterAll(async () => {
  if (!ready && !seeded) return;
  const { prisma } = await import("../lib/db");
  if (seeded) await seedDemo(prisma);
  await prisma.$disconnect();
}, 120_000);
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
      const params = Promise.resolve({ role: pg.role, ...(pg.segments?.() ?? {}) });
      h.queries = 0;
      const pageEl = createElement(page.default, { params, searchParams: Promise.resolve(pg.search ?? {}) });
      const tree = await RoleLayout({ children: pageEl, params });
      const root = await Root({ children: tree as ReactNode });
      await render(root);
      console.log(`QB ${pg.role} ${pg.name}: ${h.queries} queries (budget ${pg.budget})`);
      expect(h.queries, `${pg.name} ran no queries, the harness is not rendering it`).toBeGreaterThan(3);
      expect(h.queries, `${pg.name} used ${h.queries} queries, budget ${pg.budget}`).toBeLessThanOrEqual(pg.budget);
    }, 60_000);
  }
});
