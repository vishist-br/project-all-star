import { PrismaClient } from "@prisma/client";
import { expect as baseExpect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { scratchUrl } from "../db";

/** Routes compile on first visit in `next dev`, so give web-first assertions more room than the 5s default. */
export const expect = baseExpect.configure({ timeout: 25_000 });

export type RoleName = "owner" | "coach" | "customer";
export type Actor = { tenant: string; role: RoleName; email: string };

export const PORT = Number(process.env.E2E_PORT ?? 3211);
export const BASE_URL = `http://127.0.0.1:${PORT}`;

const mk = (tenant: string, role: RoleName, local: string): Actor => ({ tenant, role, email: `${local}@${tenant}.example.test` });

/** Rich seed people (all synthetic). demo-gym: Gamma (c1) runs Morning/Evening, Delta (c2) the PT slot. */
export const PEOPLE = {
  gymOwner: mk("demo-gym", "owner", "owner"),
  gymCoach: mk("demo-gym", "coach", "c1"),
  gymCoach2: mk("demo-gym", "coach", "c2"),
  gymM1: mk("demo-gym", "customer", "member-m1"),
  gymM2: mk("demo-gym", "customer", "member-m2"),
  gymM3: mk("demo-gym", "customer", "member-m3"),
  gymM4: mk("demo-gym", "customer", "member-m4"),
  gymM5: mk("demo-gym", "customer", "member-m5"),
  karateOwner: mk("demo-karate", "owner", "owner"),
  karateCoach: mk("demo-karate", "coach", "c1"),
  karateCustomer: mk("demo-karate", "customer", "member-a1"),
  karateParent: mk("demo-karate", "customer", "parent-g1"),
} as const;

export const GYM_NAME = "Sample Iron Works (demo gym)";
export const KARATE_NAME = "Sample Dojo (demo karate academy)";

/** IST calendar date, like the app uses. */
export const istToday = (plusDays = 0) => new Date(Date.now() + 330 * 60_000 + plusDays * 86_400_000).toISOString().slice(0, 10);

/** Unique-per-run suffix so tests never collide with each other or with a previous run on the same database. */
export const uniq = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

// ---------------------------------------------------------------------------------------------
// Console and network hygiene (scenario 8). One collector per browser context; every page of the
// context (including popups) is watched.
// ---------------------------------------------------------------------------------------------

// The Performance.measure message is a React dev-build quirk (negative timestamp in a background context), not product code.
const IGNORED_CONSOLE = [/cannot have a negative time stamp/i, /Download the React DevTools/i, /\[HMR\]/i, /\[Fast Refresh\]/i, /webpack-hmr/i, /^%c/];

export class Hygiene {
  readonly issues: string[] = [];
  private allowed: RegExp[] = [];
  /** While true, failed requests caused by the browser being offline are expected. */
  offline = false;
  readonly label: string;
  /** Every distinct "METHOD path status" seen, for debugging. */
  readonly seen = new Set<string>();

  constructor(label: string) {
    this.label = label;
  }

  attach(context: BrowserContext) {
    const watch = (page: Page) => {
      page.on("console", (m) => {
        if (m.type() !== "error") return;
        const text = m.text();
        // The status code of a failed request is reported by the response listener below.
        if (/^Failed to load resource/.test(text)) return;
        if (IGNORED_CONSOLE.some((r) => r.test(text))) return;
        this.add(`console.error on ${new URL(page.url() || "http://x/").pathname}: ${text.slice(0, 300)}`);
      });
      page.on("pageerror", (e) => !IGNORED_CONSOLE.some((r) => r.test(String(e.message))) && this.add(`uncaught error on ${new URL(page.url() || "http://x/").pathname}: ${String(e.message).slice(0, 300)}`));
      page.on("response", (r) => {
        const u = new URL(r.url());
        if (u.origin !== BASE_URL) return;
        const line = `${r.request().method()} ${u.pathname}${u.search ? "?…" : ""} ${r.status()}`;
        this.seen.add(line);
        if (r.status() >= 400) this.add(`HTTP ${line}`);
      });
      page.on("requestfailed", (r) => {
        const err = r.failure()?.errorText ?? "";
        if (/ERR_ABORTED|NS_BINDING_ABORTED/.test(err)) return; // navigation or prefetch cancelled
        if (this.offline && /INTERNET_DISCONNECTED|OFFLINE/.test(err)) return;
        const u = new URL(r.url());
        this.add(`request failed ${r.method()} ${u.pathname} (${err})`);
      });
    };
    context.pages().forEach(watch);
    context.on("page", watch);
  }

  private add(msg: string) {
    if (this.allowed.some((r) => r.test(msg))) return;
    this.issues.push(`[${this.label}] ${msg}`);
  }

  /** Runs `fn` while the given messages are expected (for example a deliberate 409). */
  async allowing<T>(patterns: RegExp[], fn: () => Promise<T>): Promise<T> {
    const before = this.allowed;
    this.allowed = [...before, ...patterns];
    try {
      return await fn();
    } finally {
      this.allowed = before;
    }
  }

  assertClean() {
    expect(this.issues, `console errors or failed requests:\n${this.issues.join("\n")}`).toEqual([]);
  }
}

export type Session = { context: BrowserContext; page: Page; hygiene: Hygiene; actor: Actor };

/** A separate browser context, really signed in by the dev magic link (the same route the smoke tests use). */
export async function openAs(browser: Browser, actor: Actor, viewport = { width: 1280, height: 900 }): Promise<Session> {
  const context = await browser.newContext({ baseURL: BASE_URL, viewport });
  context.setDefaultNavigationTimeout(60_000); // a stalled dev-server compile is retried by retryAborted
  const hygiene = new Hygiene(`${actor.role}@${actor.tenant}`);
  hygiene.attach(context);
  const res = await context.request.post("/api/v1/dev/magic-link", { data: { tenantSlug: actor.tenant, email: actor.email } });
  expect(res.status(), `dev magic link for ${actor.email}`).toBe(200);
  const { url } = (await res.json()) as { url: string };
  const page = await context.newPage();
  retryAborted(page);
  await page.goto(url);
  // The role root redirects to its landing screen, so wait for either end of that hop (a poll can miss the middle).
  const landed = { owner: /\/owner(\/dashboard)?$/, coach: /\/coach(\/today)?$/, customer: /\/customer(\/home)?$/ }[actor.role];
  await expect(page).toHaveURL(landed, { timeout: 60_000 });
  // Really signed in (not the demo picker): the session cookie exists and the picker is gone.
  expect((await context.cookies()).some((c) => c.name === "as_access")).toBe(true);
  await expect(page.getByRole("combobox", { name: "Business", exact: true })).toHaveCount(0);
  return { context, page, hygiene, actor };
}

/**
 * `next dev` can full-reload every open tab when another tab makes it compile a new route, which
 * aborts or stalls a navigation that is in flight (net::ERR_ABORTED, or a load that never finishes). That is a dev-server artefact, so
 * navigations are retried a few times; a page that never loads still fails the test.
 */
export function retryAborted(page: Page) {
  const original = page.goto.bind(page);
  page.goto = (async (url: string, options?: Parameters<Page["goto"]>[1]) => {
    let last: unknown;
    for (let i = 0; i < 4; i++) {
      try {
        return await original(url, options);
      } catch (e) {
        last = e;
        if (!/ERR_ABORTED|frame was detached|Timeout \d+ms exceeded/.test(String((e as Error).message))) throw e;
      }
    }
    throw last;
  }) as Page["goto"];
}

export async function closeAll(...sessions: (Session | undefined)[]) {
  for (const s of sessions) await s?.context.close().catch(() => {});
}

export async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "page must not scroll sideways").toBeLessThanOrEqual(0);
}

// ---------------------------------------------------------------------------------------------
// Database access for set-up and for checks the UI cannot show (scratch database only).
// ---------------------------------------------------------------------------------------------

export async function withDb<T>(fn: (db: PrismaClient) => Promise<T>): Promise<T> {
  const db = new PrismaClient({ datasources: { db: { url: scratchUrl() } } });
  try {
    return await fn(db);
  } finally {
    await db.$disconnect();
  }
}

export async function tenantId(db: PrismaClient, slug: string) {
  return (await db.tenant.findUniqueOrThrow({ where: { slug }, select: { id: true } })).id;
}

export async function memberByName(db: PrismaClient, slug: string, displayName: string) {
  return db.member.findFirstOrThrow({ where: { tenantId: await tenantId(db, slug), displayName } });
}

/** The first text of a dashboard KPI tile, for example the Attendance percentage. */
export const tile = (page: Page, label: string) =>
  page.locator(".stat-tile").filter({ has: page.locator(".stat-label", { hasText: new RegExp(`^${label}$`) }) }).locator(".stat-value");
