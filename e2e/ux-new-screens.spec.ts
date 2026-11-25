import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { E2E_PORT, scratchUrl } from "./db";
import { collectFacts, focusIssues, runAxe } from "./helpers/ux-collect";

/**
 * STAR-100: a SHORT ux-audit subset for the workout-engine screens (not the 40 minute crawl): axe, overflow,
 * touch targets and focus at 360 px in English and Hindi, using the harness in helpers/ux-collect.ts.
 * Run: E2E_WEBPACK=1 E2E_DB_NAME=allstar_e2e_ux100 E2E_PORT=3620 npx playwright test e2e/ux-new-screens.spec.ts
 */
const BASE = `http://127.0.0.1:${E2E_PORT}`;
const SHARE_TOKEN = "ux-audit-share-token-0123456789abcdef";

test.setTimeout(30 * 60_000);

type Target = { tenant: string; role: "owner" | "coach" | "customer"; path: string };

test("new workout-engine screens at 360px, en and hi: axe, overflow, touch targets, focus", async ({ browser }) => {
  const db = new PrismaClient({ datasources: { db: { url: scratchUrl() } } });
  let planId = "";
  try {
    const tenant = await db.tenant.findFirstOrThrow({ where: { slug: "demo-gym" } });
    const plan = await db.workoutPlan.findFirstOrThrow({ where: { tenantId: tenant.id, assignments: { some: {} } }, orderBy: { id: "asc" } });
    planId = plan.id;
    // A published class summary and a share link for one member of the karate academy, with a known token.
    const karate = await db.tenant.findFirstOrThrow({ where: { slug: "demo-karate" } });
    const session = await db.session.findFirstOrThrow({ where: { tenantId: karate.id, status: "COMPLETED", attendance: { some: { status: "PRESENT" } } }, include: { attendance: { where: { status: "PRESENT" }, take: 1 } } });
    const summary = await db.classSummary.upsert({
      where: { tenantId_sessionId: { tenantId: karate.id, sessionId: session.id } },
      create: { tenantId: karate.id, sessionId: session.id, coachNote: "Sample note for the audit.", homePractice: "Sample practice." },
      update: {},
    });
    await db.classSummaryShare.create({
      data: { tenantId: karate.id, summaryId: summary.id, memberId: session.attendance[0].memberId, tokenHash: createHash("sha256").update(SHARE_TOKEN).digest("hex"), expiresAt: new Date(Date.now() + 7 * 86_400_000) },
    });
  } finally {
    await db.$disconnect();
  }

  const targets: Target[] = [
    { tenant: "demo-gym", role: "customer", path: "/customer/workouts/live" },
    { tenant: "demo-karate", role: "customer", path: "/customer/classes" },
    { tenant: "demo-gym", role: "customer", path: "/customer/progress/exercises" },
    { tenant: "demo-karate", role: "customer", path: "/customer/progress/skills" },
    { tenant: "demo-gym", role: "owner", path: "/owner/insights" },
    { tenant: "demo-gym", role: "coach", path: `/coach/plans/${planId}/send` },
    { tenant: "demo-gym", role: "coach", path: `/coach/plans/${planId}/results` },
    { tenant: "demo-karate", role: "owner", path: `/share/class/${SHARE_TOKEN}` },
  ];

  const out: string[] = [];
  for (const t of targets) {
    const context = await browser.newContext({ baseURL: BASE, viewport: { width: 360, height: 780 } });
    await context.addCookies([
      { name: "demo_tenant", value: t.tenant, url: BASE },
      { name: "demo_role", value: t.role, url: BASE },
    ]);
    const page = await context.newPage();
    page.setDefaultTimeout(60_000);
    for (const locale of ["en", "hi"]) {
      await context.addCookies([{ name: "locale", value: locale, url: BASE }]);
      const res = await page.goto(t.path, { waitUntil: "load" });
      await page.waitForLoadState("networkidle").catch(() => {});
      const f = await collectFacts(page, { tenant: t.tenant, role: t.role, path: t.path, locale, viewport: 360, status: res?.status() ?? 0, consoleErrors: [], failedRequests: [] });
      const axe = await runAxe(page);
      const focus = await focusIssues(page);
      const key = `${t.path.replace(planId, "<plan>").replace(SHARE_TOKEN, "<token>")} [${locale}]`;
      if (f.status >= 400) out.push(`${key}: HTTP ${f.status}`);
      if (f.alerts.length) out.push(`${key}: alert "${f.alerts[0]}"`);
      if (f.overflowPx > 0) out.push(`${key}: overflow +${f.overflowPx}px by ${f.offenders.slice(0, 2).join(" | ")}`);
      if (f.smallTargets.length) out.push(`${key}: small targets ${f.smallTargets.slice(0, 4).join(" | ")}`);
      if (f.clipped.length) out.push(`${key}: clipped ${f.clipped.slice(0, 2).join(" | ")}`);
      if (f.h1Count !== 1) out.push(`${key}: ${f.h1Count} h1`);
      for (const v of axe) out.push(`${key}: axe ${v.id} (${v.impact}) ${v.help} -> ${v.nodes[0]}`);
      for (const i of focus) out.push(`${key}: no visible focus on ${i}`);
      await page.screenshot({ path: `test-results/ux-new/${t.role}${t.path.replace(/[^a-z0-9]+/gi, "-").slice(0, 50)}-${locale}.png`, fullPage: true }).catch(() => {});
    }
    await context.close();
  }
  console.log(`UX-FINDINGS (${out.length})\n${out.join("\n")}`);
  expect(out, "ux findings").toEqual([]);
});
