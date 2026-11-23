import { expect, test } from "@playwright/test";
import { DEMO_ROLE_COOKIE, DEMO_TENANT_COOKIE } from "../lib/demo";

// STAR-93: per-page speed budget on the rich demo seed. Asserts the HTML size and the time to first
// byte of each key page, and that every page response carries a well-formed Server-Timing header.
//
//   E2E_WEBPACK=1 E2E_DB_NAME=allstar_e2e_perf93 E2E_PORT=3293 npx playwright test e2e/perf-budget.spec.ts
//
// The dev server (`next dev`, the only mode the e2e harness runs) is slower and its HTML bigger than
// production, so the ceilings are wide enough to be stable and tight enough to catch a regression
// such as a page that ships a whole table again (STAR-91 trimmed the dashboard and the workouts library). The query count per page
// is guarded separately and exactly in tests/query-budget.test.ts. Tighten ceilings when pages get
// cheaper; do not raise them to make a run pass without finding what grew.

type Budget = { role: "owner" | "coach" | "customer"; path: string; maxHtmlKb: number; maxTtfbMs: number };

const PAGES: Budget[] = [
  { role: "owner", path: "/owner/dashboard", maxHtmlKb: 250, maxTtfbMs: 2000 },
  { role: "owner", path: "/owner/members", maxHtmlKb: 70, maxTtfbMs: 1500 },
  { role: "owner", path: "/owner/workouts", maxHtmlKb: 90, maxTtfbMs: 1500 },
  { role: "coach", path: "/coach/today", maxHtmlKb: 45, maxTtfbMs: 1500 },
  { role: "coach", path: "/coach/members", maxHtmlKb: 60, maxTtfbMs: 1500 },
  { role: "customer", path: "/customer/home", maxHtmlKb: 50, maxTtfbMs: 1500 },
  { role: "customer", path: "/customer/workouts", maxHtmlKb: 80, maxTtfbMs: 1500 },
];

const RUNS = 3;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

for (const pg of PAGES) {
  test(`${pg.role} ${pg.path}: HTML under ${pg.maxHtmlKb} KB, first byte under ${pg.maxTtfbMs} ms`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL });
    await context.addCookies([
      { name: DEMO_TENANT_COOKIE, value: "demo-gym", url: baseURL! },
      { name: DEMO_ROLE_COOKIE, value: pg.role, url: baseURL! },
    ]);
    try {
      // First visit compiles the route in `next dev`; it is not what the budget measures.
      const warm = await context.request.get(pg.path);
      expect(warm.status(), "warm-up").toBe(200);

      const ttfb: number[] = [];
      const sizes: number[] = [];
      let timing = "";
      for (let i = 0; i < RUNS; i++) {
        const t0 = performance.now();
        const res = await context.request.get(pg.path);
        // Headers resolve when the first bytes arrive, before the body is read.
        ttfb.push(performance.now() - t0);
        expect(res.status()).toBe(200);
        sizes.push((await res.body()).byteLength);
        timing = res.headers()["server-timing"] ?? "";
      }
      const kb = median(sizes) / 1024;
      const first = median(ttfb);
      console.log(`PERF ${pg.path}: html ${kb.toFixed(1)} KB, ttfb ${first.toFixed(0)} ms, server-timing "${timing}"`);

      expect(kb, `${pg.path} HTML is ${kb.toFixed(1)} KB`).toBeLessThanOrEqual(pg.maxHtmlKb);
      expect(first, `${pg.path} first byte took ${first.toFixed(0)} ms`).toBeLessThanOrEqual(pg.maxTtfbMs);
      // Server-Timing: present, only `name;dur=<number>` entries, nothing else (no ids, urls or values).
      expect(timing).toMatch(/^[a-z]+;dur=\d+(\.\d+)?(, [a-z]+;dur=\d+(\.\d+)?)*$/);
    } finally {
      await context.close();
    }
  });
}
