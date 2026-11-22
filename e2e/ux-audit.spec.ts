import { PrismaClient } from "@prisma/client";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { E2E_PORT, scratchUrl } from "./db";
import { en } from "../lib/i18n/messages/en";
import { hi } from "../lib/i18n/messages/hi";
import { kn } from "../lib/i18n/messages/kn";
import { collectFacts, focusIssues, runAxe, type Facts, type Viewport } from "./helpers/ux-collect";
import {
  BRANDING_RE, DETAIL_PATTERNS, NEGATIVE_FRAMING_RE, PHONE_RE, PLACEHOLDER_RE, PUBLIC_PATHS, REAL_PERSON_RE,
  ROLES, STACK_TRACE_RE, SURVEILLANCE_RE, TENANT_SLUGS, basePaths, type Role,
} from "./helpers/ux-routes";

/**
 * STAR-76 UX quality audit. One crawl (beforeAll) visits every reachable page for 3 demo tenants x 3 roles
 * (demo mode cookies) plus an empty tenant (real magic-link sessions), at 360, 768 and 1280 px in English
 * and at 360 px in Hindi and Kannada, collects facts and screenshots, then each test asserts one category.
 *
 * Known defects are listed in KNOWN with their Notion bug id: matching findings are reported as annotations
 * so the suite stays green but tracked. The list is empty now: every finding fails its check.
 * Run: E2E_WEBPACK=1 E2E_DB_NAME=allstar_e2e_qa76 E2E_PORT=3276 npx playwright test e2e/ux-audit.spec.ts
 */

type F = Facts & { imgs: string[] };
const BASE = `http://127.0.0.1:${E2E_PORT}`;
const OUT = "test-results/ux-audit";
// Crawl cache (gitignored): UX_REUSE=1 re-runs the checks on the last crawl without visiting pages again.
const CACHE = "playwright-report/ux-facts.json";
const EMPTY_SLUG = "e2e-empty-gym";
const facts: F[] = [];
const emptyFacts: F[] = [];
const keyOf = (f: F) => `${f.tenant}/${f.role}${f.path}@${f.viewport}${f.locale === "en" ? "" : "[" + f.locale + "]"}`;

// ---- Known defects: [bug id, check, regex matched against the finding string] -----------------------
// Every defect from the first audit (STAR-83 to STAR-90 and the three Low items) is fixed, so the list is empty and all
// findings fail the checks. Add an entry only for a newly found, filed defect.
const KNOWN: { bug: string; check: string; match: RegExp; title: string }[] = [];

function report(check: string, findings: string[]) {
  const unknown: string[] = [];
  for (const f of findings) {
    const k = KNOWN.find((x) => x.check === check && x.match.test(f));
    if (k) test.info().annotations.push({ type: `known ${k.bug}`, description: f });
    else unknown.push(f);
  }
  const dir = `${OUT}/findings`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/${check}.json`, JSON.stringify(findings, null, 1));
  if (process.env.UX_DISCOVER) return; // discovery mode: write findings files only
  expect(unknown, `${check}: ${unknown.length} finding(s)`).toEqual([]);
}

const slugOf = (path: string) => path === "/" ? "root" : (path.replace(/^\/(?:owner|coach|customer)\/?/, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home").slice(0, 40);
const IGNORED_CONSOLE = /Download the React DevTools|\[Fast Refresh\]|HMR/i;

async function visit(page: Page, ctx: { tenant: string; role: string }, path: string, locale: string, viewport: Viewport, level: "full" | "text", shot: boolean, errors: { c: string[]; r: string[] }): Promise<F> {
  errors.c.length = 0;
  errors.r.length = 0;
  const res = await page.goto(path, { waitUntil: "load" });
  await page.waitForLoadState("networkidle").catch(() => {});
  const status = res?.status() ?? 0;
  const base = { tenant: ctx.tenant, role: ctx.role, path, locale, viewport, status, consoleErrors: [...errors.c], failedRequests: [...errors.r] };
  const out = (await collectFacts(page, base)) as F;
  out.imgs = await page.evaluate(() => [...document.images].map((i) => i.getAttribute("src") || ""));
  if (level === "full") {
    out.axe = await runAxe(page);
    out.focusIssues = await focusIssues(page);
    if (shot) await page.screenshot({ path: `${OUT}/${ctx.tenant}__${ctx.role}__${slugOf(path)}__360.png`, fullPage: true }).catch(() => {});
  }
  return out;
}

const hangs: string[] = [];
function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout ${ms}ms: ${what}`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

async function crawlContext(browser: Browser, tenant: string, role: Role | "public", sink: F[], context: BrowserContext, paths: string[], discover: boolean) {
  const errors = { c: [] as string[], r: [] as string[] };
  const newPage = async () => {
    const page = await context.newPage();
    page.setDefaultTimeout(60_000);
    page.on("console", (m) => { if (m.type() === "error" && !IGNORED_CONSOLE.test(m.text())) errors.c.push(m.text().slice(0, 200)); });
    page.on("pageerror", (e) => errors.c.push(`pageerror: ${e.message.slice(0, 200)}`));
    page.on("response", (r) => { if (r.status() >= 400) errors.r.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, "")}`); });
    page.on("requestfailed", (r) => { if (r.url().startsWith(BASE) && !/ERR_ABORTED/.test(r.failure()?.errorText ?? "")) errors.r.push(`FAILED ${r.url().replace(BASE, "")} ${r.failure()?.errorText}`); });
    return page;
  };
  let page = await newPage();
  const ctx = { tenant, role };
  const seen = new Set<string>();
  const queue = [...paths];
  const details = new Set<string>();
  for (let i = 0; i < queue.length; i++) {
    const path = queue[i];
    if (seen.has(path)) continue;
    seen.add(path);
    if (process.env.UX_DEBUG) process.stderr.write(`[ux] ${tenant}/${role} ${path}\n`);
    for (let attempt = 1; attempt <= 2; attempt++) {
    await context.addCookies([{ name: "locale", value: "en", url: BASE }]);
    try {
      await withTimeout((async () => {
        await page.setViewportSize({ width: 360, height: 780 });
        const a = await visit(page, ctx, path, "en", 360, "full", true, errors);
        sink.push(a);
        if (discover) {
          for (const href of a.mainLinks) {
            const clean = href.split("?")[0];
            if (DETAIL_PATTERNS.some((re) => re.test(clean)) && ![...details].some((d) => d.replace(/[^/]+$/, "") === clean.replace(/[^/]+$/, ""))) {
              details.add(clean);
              queue.push(clean);
            }
          }
        }
        // Same load, other viewports: layout, touch targets, axe and a screenshot at 1280.
        for (const vp of [768, 1280] as const) {
          await page.setViewportSize({ width: vp, height: vp === 768 ? 1024 : 900 });
          await page.waitForTimeout(60);
          const b = (await collectFacts(page, { tenant, role, path, locale: "en", viewport: vp, status: a.status, consoleErrors: [], failedRequests: [] })) as F;
          b.imgs = a.imgs;
          if (vp === 1280) {
            b.axe = await runAxe(page);
            await page.screenshot({ path: `${OUT}/${tenant}__${role}__${slugOf(path)}__1280.png`, fullPage: true, timeout: 20_000 }).catch(() => {});
          }
          sink.push(b);
        }
        await page.setViewportSize({ width: 360, height: 780 });
        for (const locale of ["hi", "kn"]) {
          await context.addCookies([{ name: "locale", value: locale, url: BASE }]);
          sink.push(await visit(page, ctx, path, locale, 360, "text", false, errors));
        }
      })(), 240_000, path);
      break;
    } catch (e) {
      // Dev-server compile or HMR navigation abort: retry once on a fresh page before recording a hang.
      if (attempt === 2) hangs.push(`${tenant}/${role}${path}: ${(e as Error).message.split("\n")[0].slice(0, 120)}`);
      else sink.splice(0, sink.length, ...sink.filter((x) => !(x.tenant === tenant && x.role === role && x.path === path)));
      page.close().catch(() => {});
      page = await newPage();
    }
    }
    await context.addCookies([{ name: "locale", value: "en", url: BASE }]);
  }
  await page.close().catch(() => {});
}

test.describe.configure({ mode: "serial" });

async function crawlDemoTenant(browser: Browser, tenant: string) {
  for (const role of ROLES) {
    const context = await browser.newContext({ baseURL: BASE, viewport: { width: 360, height: 780 } });
    await context.addCookies([
      { name: "demo_tenant", value: tenant, url: BASE },
      { name: "demo_role", value: role, url: BASE },
      { name: "locale", value: "en", url: BASE },
    ]);
    await crawlContext(browser, tenant, role, facts, context, [...(role === "owner" ? PUBLIC_PATHS : []), ...basePaths(role)], true);
    await context.close();
  }
}

const emptyContexts: { role: Role; context: BrowserContext }[] = [];

async function setupEmptyTenant(browser: Browser) {
  // An empty tenant (no members, batches, sessions or plans) for the empty states, real magic-link sessions.
  const prisma = new PrismaClient({ datasources: { db: { url: scratchUrl() } } });
  try {
    const tenant = await prisma.tenant.create({ data: { slug: EMPTY_SLUG, name: "Sample Empty Gym" } });
    await prisma.tenantTheme.create({ data: { tenantId: tenant.id, primaryColor: "#1F6FEB", secondaryColor: "#0B3D91" } });
    for (const role of ["OWNER", "COACH", "CUSTOMER"] as const) {
      await prisma.user.create({ data: { tenantId: tenant.id, role, email: `${role.toLowerCase()}@${EMPTY_SLUG}.example.test`, name: `Sample ${role.toLowerCase()}` } });
    }
  } finally {
    await prisma.$disconnect();
  }
  for (const role of ROLES) {
    const context = await browser.newContext({ baseURL: BASE, viewport: { width: 360, height: 780 } });
    // The dev server may reload the page mid sign-in while other routes compile (the one-time token is then
    // gone), so retry with a fresh link until the session cookie is set.
    let ok = false;
    for (let attempt = 1; attempt <= 4 && !ok; attempt++) {
      const res = await context.request.post("/api/v1/dev/magic-link", { data: { tenantSlug: EMPTY_SLUG, email: `${role}@${EMPTY_SLUG}.example.test` } });
      const { url } = (await res.json()) as { url: string };
      const p = await context.newPage();
      await p.goto(url).catch(() => {});
      for (let i = 0; i < 40 && !ok; i++) {
        ok = (await context.cookies()).some((c) => c.name === "as_access");
        if (!ok) await p.waitForTimeout(500);
      }
      await p.close().catch(() => {});
    }
    expect(ok, `${role} signed in to the empty tenant`).toBe(true);
    emptyContexts.push({ role, context });
  }
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(90 * 60_000);
  mkdirSync(OUT, { recursive: true });
  if (process.env.UX_REUSE && existsSync(CACHE)) {
    const saved = JSON.parse(readFileSync(CACHE, "utf8"));
    facts.push(...saved.facts);
    emptyFacts.push(...saved.emptyFacts);
    hangs.push(...saved.hangs);
    return;
  }
  const tenants = (process.env.UX_TENANTS ? process.env.UX_TENANTS.split(",") : [...TENANT_SLUGS]) as string[];
  // One lane per tenant plus the empty tenant, crawled concurrently (the dev server compiles each route once).
  await setupEmptyTenant(browser); // sign-in first, alone, so no dev compile reloads it
  await Promise.all([
    ...tenants.map((t) => crawlDemoTenant(browser, t)),
    (async () => {
      for (const { role, context } of emptyContexts) {
        await crawlContext(browser, EMPTY_SLUG, role, emptyFacts, context, basePaths(role), false);
        await context.close();
      }
    })(),
  ]);
  mkdirSync("playwright-report", { recursive: true });
  writeFileSync(CACHE, JSON.stringify({ facts, emptyFacts, hangs }));
});

const en360 = () => facts.filter((f) => f.viewport === 360 && f.locale === "en");
const every = () => [...facts, ...emptyFacts];

// ---- 1 + 2: placeholders and real data -------------------------------------------------------------
test("crawl reached every role, tenant and sub-page", () => {
  const paths = new Set(en360().map((f) => `${f.role}${f.path}`));
  expect(en360().length).toBeGreaterThan(60);
  for (const t of TENANT_SLUGS) for (const r of ROLES) expect(en360().some((f) => f.tenant === t && f.role === r)).toBe(true);
  // Detail pages were discovered from links (member, plan, coach, session, exercise).
  for (const kind of ["members/", "plans/", "coaches/", "sessions/", "exercise/"]) expect([...paths].some((p) => p.includes(`/${kind}`)), `detail page ${kind}`).toBe(true);
});

test("1 no placeholder, lorem, TODO or coming-soon text and no empty headings", () => {
  const out: string[] = [];
  for (const f of every().filter((x) => x.locale === "en" && x.viewport === 360)) {
    for (const src of [f.texts, f.attrTexts, f.title]) {
      const m = src.match(PLACEHOLDER_RE);
      if (m) out.push(`${keyOf(f)}: "${m[0]}"`);
    }
    if (f.emptyHeadings) out.push(`${keyOf(f)}: ${f.emptyHeadings} empty heading(s)`);
  }
  // Source-level: the placeholder message and branch must be gone.
  for (const [k, v] of Object.entries(en)) if (PLACEHOLDER_RE.test(v)) out.push(`message ${k}: "${v}"`);
  report("placeholders", out);
});

const DATA_PAGES: { role: Role; re: RegExp; min: "items" | "chart" }[] = [
  { role: "owner", re: /^\/owner\/dashboard$/, min: "chart" },
  { role: "owner", re: /^\/owner\/members$/, min: "items" },
  { role: "owner", re: /^\/owner\/batches$/, min: "items" },
  { role: "owner", re: /^\/owner\/coaches$/, min: "items" },
  { role: "owner", re: /^\/owner\/workouts$/, min: "items" },
  { role: "coach", re: /^\/coach\/today\/week$/, min: "items" },
  { role: "coach", re: /^\/coach\/members$/, min: "items" },
  { role: "coach", re: /^\/coach\/plans$/, min: "items" },
  { role: "coach", re: /^\/coach\/workouts$/, min: "items" },
  { role: "coach", re: /^\/coach\/record$/, min: "items" },
  { role: "customer", re: /^\/customer\/home$/, min: "items" },
  { role: "customer", re: /^\/customer\/workouts$/, min: "items" },
  { role: "customer", re: /^\/customer\/schedule$/, min: "items" },
  { role: "customer", re: /^\/customer\/progress$/, min: "items" },
  { role: "customer", re: /^\/customer\/profile$/, min: "items" },
];

test("2a every page with seeded data shows real data, not an empty state or error", () => {
  const out: string[] = [];
  for (const f of en360()) {
    if (f.path !== "/" && f.status >= 400) out.push(`${keyOf(f)}: HTTP ${f.status}`);
    if (f.alerts.length && !PUBLIC_PATHS.includes(f.path)) out.push(`${keyOf(f)}: alert "${f.alerts[0].slice(0, 80)}"`);
    const rule = DATA_PAGES.find((d) => d.role === f.role && d.re.test(f.path));
    if (!rule) continue;
    const has = rule.min === "chart" ? f.charts > 0 : f.mainItems > 0;
    if (!has) out.push(`${keyOf(f)}: no ${rule.min} rendered`);
    if (f.stateTitles.length) out.push(`${keyOf(f)}: shows empty/error state "${f.stateTitles[0]}" although the seed has data`);
    if (f.texts.length < 120) out.push(`${keyOf(f)}: nearly empty page (${f.texts.length} chars)`);
  }
  report("data", out);
});

test("2b the empty tenant shows friendly empty states (title, text), never a blank page, error or NaN", () => {
  const out: string[] = [];
  for (const f of emptyFacts.filter((x) => x.viewport === 360 && x.locale === "en")) {
    if (f.status >= 400) out.push(`${keyOf(f)}: HTTP ${f.status}`);
    if (f.alerts.length) out.push(`${keyOf(f)}: alert "${f.alerts[0].slice(0, 80)}"`);
    if (f.texts.length < 60) out.push(`${keyOf(f)}: blank page`);
    if (STACK_TRACE_RE.test(f.texts)) out.push(`${keyOf(f)}: technical error text`);
    if (f.h1Count !== 1) out.push(`${keyOf(f)}: ${f.h1Count} h1`);
    const needsState = /\/(members|batches|plans|today|schedule|progress|record|coaches|home|updates)$/.test(f.path) && !/\/(owner|coach)$/.test(f.path);
    const saysEmpty = /\b(no|nothing|not enough|yet|empty|fill in)\b/i.test(f.texts);
    if (needsState && f.stateTitles.length === 0 && f.mainItems <= 1 && !saysEmpty) out.push(`${keyOf(f)}: no empty state and no content`);
  }
  report("empty-states", out);
});

// ---- 3: layout --------------------------------------------------------------------------------------
test("3a no horizontal scroll at 360, 768 and 1280", () => {
  report("overflow", every().filter((f) => f.locale === "en" && f.overflowPx > 0).map((f) => `${keyOf(f)}: +${f.overflowPx}px by ${f.offenders.slice(0, 2).join(" | ")}`));
});

test("3b touch targets of primary controls are at least 44px", () => {
  const out: string[] = [];
  for (const f of every().filter((x) => x.locale === "en" && x.smallTargets.length)) out.push(`${keyOf(f)}: ${f.smallTargets.slice(0, 3).join(" | ")}`);
  report("touch-targets", out);
});

test("3c nothing is clipped or broken (hidden overflowing text, broken images)", () => {
  const out: string[] = [];
  for (const f of every().filter((x) => x.locale === "en")) {
    if (f.clipped.length) out.push(`${keyOf(f)}: clipped ${f.clipped.slice(0, 2).join(" | ")}`);
    if (f.brokenImages.length) out.push(`${keyOf(f)}: broken image ${f.brokenImages[0]}`);
  }
  report("clipping", out);
});

// ---- 4: accessibility -------------------------------------------------------------------------------
test("4a axe-core: no serious or critical violations (360 and 1280, every tenant theme)", () => {
  const out: string[] = [];
  for (const f of facts.filter((x) => x.axe)) {
    for (const v of f.axe!.filter((a) => a.impact === "serious" || a.impact === "critical")) out.push(`${keyOf(f)}: ${v.id} (${v.impact}) ${v.help} -> ${v.nodes[0]}`);
  }
  report("axe", out);
});

test("4b structure: one h1, heading order, landmarks, labels and names", () => {
  const out: string[] = [];
  for (const f of every().filter((x) => x.locale === "en" && x.viewport === 360)) {
    if (f.h1Count !== 1) out.push(`${keyOf(f)}: ${f.h1Count} h1`);
    if (f.landmarks.main !== 1) out.push(`${keyOf(f)}: ${f.landmarks.main} main landmarks`);
    if (f.role !== "public" && f.path.split("/").length <= 4 && PUBLIC_PATHS.includes(f.path) === false && f.landmarks.nav < 1) out.push(`${keyOf(f)}: no nav landmark`);
    for (let i = 1; i < f.headings.length; i++) if (f.headings[i].level - f.headings[i - 1].level > 1) { out.push(`${keyOf(f)}: heading jumps h${f.headings[i - 1].level} to h${f.headings[i].level}`); break; }
    for (const v of (f.axe ?? []).filter((a) => !a.nodes.every((n) => n.includes("demo-switcher")))) if (/^(label|button-name|link-name|select-name|image-alt|input-button-name|aria-.*|landmark-.*|region|page-has-heading-one|heading-order|html-has-lang|document-title|duplicate-id.*|list|listitem)$/.test(v.id) && v.impact !== "serious" && v.impact !== "critical") out.push(`${keyOf(f)}: ${v.id} (${v.impact}) ${v.nodes[0]}`);
  }
  report("structure", out);
});

test("4c visible keyboard focus on the first controls of every page", () => {
  report("focus", facts.filter((f) => f.focusIssues?.length).map((f) => `${keyOf(f)}: no focus ring on ${f.focusIssues!.join(", ")}`));
});

// ---- 5: i18n ----------------------------------------------------------------------------------------
const KEYS = Object.keys(en);
const KEY_RE = new RegExp(`(?<![\\w.])(?:${KEYS.map((k) => k.replace(/\./g, "\\.")).join("|")})(?![\\w])`);
const GENERIC_KEY_RE = /(?<![\w./@-])(?:nav|plans|owner|coach|customer|common|shell|ui|imp|dash|role|lang|demo|footer|review|sessions|members|about|auth|sign|batches|workouts|goals|progress|schedule|profile|updates|analytics|settings|coaches|rec|rollcall|booking|mem|plan)\.[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)*(?![\w@-])/;

test("5a Hindi and Kannada: no raw message keys, html lang set, review marker shown", () => {
  const out: string[] = [];
  for (const f of [...facts, ...emptyFacts].filter((x) => x.viewport === 360)) {
    const m = (f.texts + "\n" + f.attrTexts).match(KEY_RE) ?? f.texts.match(GENERIC_KEY_RE);
    if (m) out.push(`${keyOf(f)}: raw key "${m[0]}"`);
    if (f.locale !== "en" && f.htmlLang !== f.locale) out.push(`${keyOf(f)}: <html lang="${f.htmlLang}">`);
    const shell = f.landmarks.header > 0 && f.path !== "/" && f.path !== "/about" && f.path !== "/sign-in" && f.status < 400;
    if (f.locale !== "en" && shell && !f.reviewBannerVisible) out.push(`${keyOf(f)}: review banner missing`);
    if (f.locale === "en" && f.reviewBannerVisible) out.push(`${keyOf(f)}: review banner shown in English`);
  }
  report("i18n-keys", out);
});

test("5b translations: every key present in hi and kn, not left as English, same placeholders", () => {
  const out: string[] = [];
  const ALLOWED_SAME = /^[\d\s\W]*$|^(OK|UPI|CSV|QR|PDF|WhatsApp|English|Hindi|Kannada)$/;
  for (const [loc, dict] of [["hi", hi], ["kn", kn]] as const) {
    for (const k of KEYS as (keyof typeof en)[]) {
      const v = dict[k];
      if (typeof v !== "string" || !v.trim()) { out.push(`${loc} ${k}: missing`); continue; }
      if (v === en[k] && /[A-Za-z]{4,}/.test(en[k].replace(/\{\w+\}/g, "")) && !ALLOWED_SAME.test(en[k]) && !/^lang\./.test(k)) out.push(`${loc} ${k}: still English "${en[k].slice(0, 50)}"`);
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
      if (ph(v) !== ph(en[k])) out.push(`${loc} ${k}: placeholders differ`);
    }
  }
  report("i18n-translations", out);
});

test("5c rendered Hindi and Kannada pages do not show English UI strings that have a translation", () => {
  const out: string[] = [];
  const longEn = KEYS.map((k) => en[k as keyof typeof en]).filter((v) => v.length >= 14 && !/\{/.test(v)).sort((a, b) => b.length - a.length);
  for (const f of facts.filter((x) => x.locale !== "en")) {
    const hit = longEn.find((v) => f.texts.includes(v));
    if (hit) out.push(`${keyOf(f)}: English text "${hit.slice(0, 60)}"`);
  }
  report("i18n-fallback", out);
});

test("5d review marker present in the hi and kn message sources", () => {
  for (const f of ["lib/i18n/messages/hi.ts", "lib/i18n/messages/kn.ts"]) expect(readFileSync(f, "utf8")).toMatch(/needs native-speaker review/i);
  expect(hi["review.banner"]).not.toBe(en["review.banner"]);
  expect(kn["review.banner"]).not.toBe(en["review.banner"]);
});

// ---- 6: wording ---------------------------------------------------------------------------------------
test("6a no accountability or surveillance wording, positive framing (messages and rendered pages)", () => {
  const out: string[] = [];
  for (const [k, v] of Object.entries(en)) {
    if (SURVEILLANCE_RE.test(v)) out.push(`message ${k}: "${v}"`);
    if (NEGATIVE_FRAMING_RE.test(v)) out.push(`message ${k}: negative framing "${v}"`);
  }
  for (const f of every().filter((x) => x.locale === "en" && x.viewport === 360)) {
    const m = f.texts.match(SURVEILLANCE_RE) ?? f.texts.match(NEGATIVE_FRAMING_RE);
    if (m) out.push(`${keyOf(f)}: "${m[0]}"`);
  }
  report("wording", out);
});

test("6b white-label: no builder branding in titles, text, footer, alt text or error pages", () => {
  const out: string[] = [];
  for (const f of every().filter((x) => x.viewport === 360)) {
    for (const [what, s] of [["text", f.texts], ["attr", f.attrTexts], ["title", f.title]] as const) {
      const m = s.match(BRANDING_RE);
      if (m) out.push(`${keyOf(f)}: ${what} "${m[0]}"`);
    }
    if (f.path !== "/sign-in" && !f.title.trim()) out.push(`${keyOf(f)}: empty document title`);
  }
  report("branding", out);
});

test("6c visibility framing: About page explains visibility and does not promise policing", () => {
  const about = en360().find((f) => f.path === "/about")!;
  expect(about.texts.toLowerCase()).toContain("visib");
  expect(about.texts).not.toMatch(SURVEILLANCE_RE);
});

// ---- 7: loading, error, empty states ------------------------------------------------------------------
test("7a loading and error boundaries exist for the role routes and the skeleton is used", () => {
  expect(existsSync("app/[role]/loading.tsx")).toBe(true);
  expect(existsSync("app/[role]/error.tsx")).toBe(true);
  const loading = readFileSync("app/[role]/loading.tsx", "utf8");
  expect(loading).toMatch(/Skeleton/);
  const withOwnLoading = readdirSync("app/[role]", { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(`app/[role]/${d.name}/loading.tsx`)).length;
  expect(withOwnLoading).toBeGreaterThanOrEqual(1);
});

async function demoPage(browser: Browser, tenant: string, role: Role) {
  const context = await browser.newContext({ baseURL: BASE, viewport: { width: 360, height: 780 } });
  await context.addCookies([{ name: "demo_tenant", value: tenant, url: BASE }, { name: "demo_role", value: role, url: BASE }]);
  return { context, page: await context.newPage() };
}

test("7b unknown ids and routes show a friendly page, not a blank screen or stack trace", async ({ browser }) => {
  const out: string[] = [];
  const cases: [Role, string][] = [
    ["coach", "/coach/members/does-not-exist"], ["owner", "/owner/members/does-not-exist"], ["owner", "/owner/coaches/does-not-exist"],
    ["coach", "/coach/plans/does-not-exist"], ["coach", "/coach/sessions/does-not-exist"], ["customer", "/customer/exercise/does-not-exist"],
    ["owner", "/owner/this-page-does-not-exist"], ["customer", "/nowhere"],
  ];
  for (const [role, path] of cases) {
    const { context, page } = await demoPage(browser, "demo-gym", role);
    const res = await page.goto(path);
    const text = await page.evaluate(() => document.body.innerText);
    const h = await page.locator("h1, h2").count();
    if (STACK_TRACE_RE.test(text)) out.push(`${role}${path}: technical text "${text.match(STACK_TRACE_RE)![0]}"`);
    if (text.trim().length < 20 || h === 0) out.push(`${role}${path}: blank or heading-less page (HTTP ${res?.status()})`);
    if (BRANDING_RE.test(text)) out.push(`${role}${path}: builder branding "${text.match(BRANDING_RE)![0]}"`);
    if ((res?.status() ?? 0) >= 500) out.push(`${role}${path}: HTTP ${res?.status()}`);
    await context.close();
  }
  report("error-pages", out);
});

test("7c forced API failure on the workout log shows a friendly message, the page stays usable", async ({ browser }) => {
  const { context, page } = await demoPage(browser, "demo-karate", "customer");
  await page.route("**/ui/workout-log", (r) => r.fulfill({ status: 500, contentType: "application/json", body: '{"error":"boom stack at x.js:1:1"}' }));
  await page.goto("/customer/home");
  const start = page.getByRole("button", { name: /^(Start|Complete)/ }).first();
  await expect(start).toBeVisible();
  await start.click();
  await page.waitForTimeout(1500);
  const text = await page.evaluate(() => document.body.innerText);
  expect(text).not.toMatch(/boom|stack at/);
  expect(text.trim().length).toBeGreaterThan(60);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // A friendly notice (sync status, toast or alert) tells the person what happened.
  await expect(page.getByTestId("sync-status").or(page.getByRole("alert")).or(page.getByRole("status")).first()).toContainText(/offline|retry|try again|sync|could not|couldn|saved|pending/i);
  await context.close();
});

test("7d forced failure of the member import endpoint shows a friendly error", async ({ browser }) => {
  const { context, page } = await demoPage(browser, "demo-gym", "owner");
  await page.route("**/ui/members-import", (r) => r.fulfill({ status: 500, contentType: "text/plain", body: "Error: boom\n    at handler (/srv/app.js:1:1)" }));
  await page.goto("/owner/members/import");
  await page.locator('input[type="file"]').setInputFiles({ name: "m.csv", mimeType: "text/csv", buffer: Buffer.from("name,phone\nSample Person,\n") });
  await page.waitForTimeout(800);
  for (const label of [/preview|check|validate|continue|next|import/i]) {
    const b = page.getByRole("button", { name: label }).first();
    if (await b.isEnabled().catch(() => false)) await b.click().catch(() => {});
  }
  await page.waitForTimeout(1500);
  const text = await page.evaluate(() => document.body.innerText);
  expect(text).not.toMatch(/boom|\/srv\/app|at handler/);
  expect(text.trim().length).toBeGreaterThan(60);
  await context.close();
});

test("7e going offline shows the offline banner", async ({ browser }) => {
  const { context, page } = await demoPage(browser, "demo-gym", "coach");
  await page.goto("/coach/today");
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.getByText(en["ui.offline"])).toBeVisible();
  await context.close();
});

// ---- 8: console errors and failed requests -------------------------------------------------------------
test("8 no console errors or failed requests on any page", () => {
  const out: string[] = [];
  for (const f of every().filter((x) => x.consoleErrors.length || x.failedRequests.length)) {
    if (f.consoleErrors.length) out.push(`${keyOf(f)}: console ${f.consoleErrors[0].slice(0, 120)}`);
    if (f.failedRequests.length) out.push(`${keyOf(f)}: request ${f.failedRequests.slice(0, 2).join(", ")}`);
  }
  report("console", out);
});

// ---- 9: seed privacy -----------------------------------------------------------------------------------
test("9 seed privacy: only Sample data, example.test emails, no phones, no personal photos", () => {
  const out: string[] = [];
  for (const f of every().filter((x) => x.locale === "en" && x.viewport === 360)) {
    const e = (f.texts + f.attrTexts).match(REAL_PERSON_RE);
    if (e) out.push(`${keyOf(f)}: non-reserved email-like text "${e[0]}"`);
    const p = f.texts.match(PHONE_RE);
    if (p) out.push(`${keyOf(f)}: phone-like text "${p[0]}"`);
    for (const src of f.imgs) if (!/^\/|^data:/.test(src) || /photo|avatar|portrait|face|selfie|\.jpe?g/i.test(src) && !/exercises?\//i.test(src)) out.push(`${keyOf(f)}: image ${src.slice(0, 80)}`);
    // Person names shown in member links must be seeded "Sample ..." names.
    for (const m of f.texts.matchAll(/Open (?!Sample)([A-Z][a-z]+ [A-Z][a-z]+)/g)) out.push(`${keyOf(f)}: non-sample person name "${m[1]}"`);
  }
  report("privacy", out);
});

// ---- 10: visual consistency (screenshots saved by the crawl) --------------------------------------------
test("10 full-page screenshots saved for every page at 360 and 1280 for every role", () => {
  test.skip(!!process.env.UX_REUSE, "screenshots are not re-taken when the crawl is reused");
  const files = readdirSync(OUT).filter((n) => n.endsWith(".png"));
  expect(files.filter((n) => n.endsWith("__360.png")).length).toBeGreaterThanOrEqual(90);
  expect(files.filter((n) => n.endsWith("__1280.png")).length).toBeGreaterThanOrEqual(90);
  const index = [...new Set(en360().map((f) => `${f.tenant}/${f.role}${f.path}`))].sort();
  writeFileSync(`${OUT}/pages.txt`, index.join("\n"));
});

test("11 every page loads and renders within the time budget (no hang)", () => {
  report("hangs", hangs);
});
