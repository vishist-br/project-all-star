import { PrismaClient } from "@prisma/client";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { scratchUrl } from "./db";

// Customer home and workouts (STAR-69): the seeded demo customers (rich seed: an active daily plan,
// one workout done and one started today, bookings and unread updates).

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

const A1 = { tenant: "demo-karate", email: "member-a1@demo-karate.example.test", plan: "Adult Daily Mobility" };
const M1 = { tenant: "demo-gym", email: "member-m1@demo-gym.example.test" };
const PARENT = { tenant: "demo-karate", email: "parent-g1@demo-karate.example.test" };

async function signIn(page: Page, request: APIRequestContext, u: { tenant: string; email: string }) {
  await page.context().clearCookies();
  const res = await request.post("/api/v1/dev/magic-link", { data: { tenantSlug: u.tenant, email: u.email } });
  expect(res.status()).toBe(200);
  const { url } = (await res.json()) as { url: string };
  await page.goto(url);
  await expect(page).toHaveURL(/\/customer\/home$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Hello");
}

const nameOf = async (li: ReturnType<Page["locator"]>) => ((await li.locator("a").first().textContent()) ?? "").replace(/\(Exercise details\)/, "").trim();
const byName = (page: Page, name: string) => page.locator("li[data-status]").filter({ hasText: name }).first();

test("home shows today's items, start/complete/skip persist after a reload, with a rest timer", async ({ page, request }) => {
  await signIn(page, request, A1);

  // Customer nav: five items, Home first.
  const nav = page.getByRole("navigation", { name: "Main navigation" }).locator("a");
  await expect(nav).toHaveText(["⌂Home", "✚Workouts", "◷Schedule", "▲Progress", "☺Profile"]);

  // Seeded state today: one done, one in progress, the rest to do.
  const plan = page.getByRole("region", { name: A1.plan });
  await expect(plan.locator('li[data-status="completed"]')).toHaveCount(1);
  const running = plan.locator('li[data-status="started"]');
  await expect(running).toHaveCount(1);
  const runningName = await nameOf(running);

  // Complete the running item with one tap: optimistic, then synced; a rest timer starts (rest is set).
  await running.getByRole("button", { name: /^Complete/ }).click();
  await expect(byName(page, runningName)).toHaveAttribute("data-status", "completed");
  await expect(page.getByRole("timer")).toBeVisible();
  await expect(page.getByTestId("sync-status")).toContainText("Synced");
  await page.getByRole("button", { name: "Skip rest" }).click();
  await expect(page.getByRole("timer")).toHaveCount(0);

  // Start one pending item, skip another (with confirmation).
  const pending = plan.locator('li[data-status="pending"]');
  expect(await pending.count()).toBeGreaterThanOrEqual(2);
  const startName = await nameOf(pending.nth(0));
  const skipName = await nameOf(pending.nth(1));
  await pending.nth(0).getByRole("button", { name: /^Start/ }).click();
  await expect(byName(page, startName)).toHaveAttribute("data-status", "started");
  await expect(page.getByTestId("sync-status")).toContainText("Synced");
  await byName(page, skipName).getByRole("button", { name: /^Skip/ }).click();
  await expect(page.getByRole("dialog")).toContainText("Skip this exercise today?");
  await page.getByRole("button", { name: "Skip it" }).click();
  await expect(byName(page, skipName)).toHaveAttribute("data-status", "skipped");
  await expect(page.getByTestId("sync-status")).toContainText("Synced");

  // Persisted: a full reload shows the server's truth.
  await page.reload();
  await expect(byName(page, runningName)).toHaveAttribute("data-status", "completed");
  await expect(byName(page, startName)).toHaveAttribute("data-status", "started");
  await expect(byName(page, skipName)).toHaveAttribute("data-status", "skipped");
  expect(await page.evaluate(() => localStorage.getItem("workoutQueue.v1"))).toBeNull();
});

test("updates: unread badge on home, feed rendered through i18n, opening marks everything read", async ({ page, request }) => {
  await signIn(page, request, A1);
  const badge = page.locator("main").getByText(/^\d+ new$/);
  await expect(badge).toBeVisible();

  await page.getByRole("link", { name: "Open updates" }).click();
  await expect(page).toHaveURL(/\/customer\/updates$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Updates");
  const feed = page.locator("ul > li").filter({ has: page.locator("time") });
  expect(await feed.count()).toBeGreaterThan(2);
  // Unread ones carry a "New" marker for this visit; text comes from i18n, not the API's English title.
  expect(await page.getByText("New", { exact: true }).count()).toBeGreaterThanOrEqual(3);
  await expect(page.locator("main")).not.toContainText("New workout plan:");
  await expect(page.getByTestId("mark-read")).toHaveAttribute("data-state", "done");
  await expect(page.getByTestId("mark-read")).toContainText("marked as read");

  // Marked read: no "New" on the next visit and home has no badge.
  await page.reload();
  await expect(page.getByText("New", { exact: true })).toHaveCount(0);
  await page.goto("/customer/home");
  await expect(page.getByText("You are all caught up.")).toBeVisible();
  await expect(page.locator("main").getByText(/^\d+ new$/)).toHaveCount(0);

  // Hindi: the same feed in the other language.
  await page.context().addCookies([{ name: "locale", value: "hi", url: page.url() }]);
  await page.goto("/customer/updates");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("अपडेट");
  await page.context().addCookies([{ name: "locale", value: "en", url: page.url() }]);
});

test("offline taps are queued on the phone, shown as waiting, and replayed in order when back online", async ({ page, request, context }) => {
  await signIn(page, request, M1);
  const pending = page.locator('li[data-status="pending"]');
  expect(await pending.count()).toBeGreaterThanOrEqual(1);
  const name = await nameOf(pending.first());

  await context.setOffline(true);
  await expect(page.getByText("You are offline.").first()).toBeVisible();
  await byName(page, name).getByRole("button", { name: /^Start/ }).click();
  await expect(byName(page, name)).toHaveAttribute("data-status", "started");
  await byName(page, name).getByRole("button", { name: /^Complete/ }).click();
  await expect(byName(page, name)).toHaveAttribute("data-status", "completed");
  await expect(byName(page, name).getByText("Waiting to sync")).toBeVisible();
  await expect(page.getByTestId("sync-status")).toContainText("2 saved on this phone");
  const saved = JSON.parse((await page.evaluate(() => localStorage.getItem("workoutQueue.v1"))) ?? "[]") as { action: string; clientId: string }[];
  expect(saved.map((q) => q.action)).toEqual(["start", "complete"]);
  expect(new Set(saved.map((q) => q.clientId)).size).toBe(1); // one clientId per item-day

  await context.setOffline(false);
  await expect(page.getByTestId("sync-status")).toContainText("Synced", { timeout: 30_000 });
  await expect(byName(page, name).getByText("Waiting to sync")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("workoutQueue.v1"))).toBeNull();
  await page.reload();
  await expect(byName(page, name)).toHaveAttribute("data-status", "completed");
});

test("workouts screen lists the assigned plans and the coming days; exercise detail shows the plan item and the catalog", async ({ page, request }) => {
  await signIn(page, request, A1);
  await page.goto("/customer/workouts");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("My workouts");
  await expect(page.getByRole("heading", { name: A1.plan }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Coming days" })).toBeVisible();
  await expect(page.getByText("Every day").first()).toBeVisible();
  expect(await page.locator("ol > li").count()).toBe(6);

  // Exercise detail from a coming-days link.
  await page.locator("ol > li ul a").first().click();
  await expect(page).toHaveURL(/\/customer\/exercise\//);
  await expect(page.getByRole("heading", { name: "In your plan" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "How to do it" })).toBeVisible();
  await expect(page.getByText("Main muscles")).toBeVisible();
  await page.goto("/customer/exercise/does-not-exist");
  await expect(page.getByText("We could not find that exercise")).toBeVisible();
});

test("a parent with several children switches between them", async ({ page, request }) => {
  const db = new PrismaClient({ datasources: { db: { url: scratchUrl() } } });
  const second = await db.member.findFirstOrThrow({ where: { displayName: "Sample Kid 02", tenant: { slug: PARENT.tenant } } });
  const guardian = await db.guardian.findFirstOrThrow({ where: { user: { email: PARENT.email } } });
  const original = second.guardianId;
  await db.member.update({ where: { id: second.id }, data: { guardianId: guardian.id } });
  try {
    await signIn(page, request, PARENT);
    const group = page.getByRole("group", { name: "Choose whose day to view" });
    await expect(group.getByRole("button")).toHaveCount(2);
    await expect(page.getByRole("main")).toContainText("Sample Kid 01's day");
    await group.getByRole("button", { name: "Sample Kid 02" }).click();
    await expect(page.getByRole("main")).toContainText("Sample Kid 02's day");
    await expect(group.getByRole("button", { name: "Sample Kid 02" })).toHaveAttribute("aria-pressed", "true");
    // The choice sticks across screens.
    await page.goto("/customer/workouts");
    await expect(group.getByRole("button", { name: "Sample Kid 02" })).toHaveAttribute("aria-pressed", "true");
  } finally {
    await db.member.update({ where: { id: second.id }, data: { guardianId: original } });
    await db.$disconnect();
  }
});

test("a customer cannot reach coach or owner screens or write to anyone else's plan", async ({ page, request }) => {
  const anon = await request.put("/ui/workout-log", { data: { clientId: "x".repeat(10) } });
  // No session: 401. In demo mode the switcher's default (owner) stands in, and owners cannot write: 403.
  expect([401, 403]).toContain(anon.status());

  await signIn(page, request, A1);
  for (const path of ["/owner/dashboard", "/coach/today", "/coach/workouts"]) {
    await page.goto(path);
    await expect(page.locator("section[role=alert]"), path).toContainText("not available for your role");
  }

  const db = new PrismaClient({ datasources: { db: { url: scratchUrl() } } });
  try {
    const other = await db.planAssignment.findFirstOrThrow({ where: { member: { displayName: "Sample Kid 02", tenant: { slug: A1.tenant } } } });
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    const res = await page.request.put("/ui/workout-log", {
      data: { clientId: "client-other-1", assignmentId: other.id, planItemId: "nope", scheduledFor: today, action: "start" },
    });
    expect(res.status()).toBe(403);
    const form = await page.request.put("/ui/workout-log", { form: { a: "b" } });
    expect(form.status()).toBe(400);
  } finally {
    await db.$disconnect();
  }
});

test("customer screens fit a 360px phone with 44px controls and no horizontal scroll", async ({ page, request }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await signIn(page, request, A1);
  for (const path of ["/customer/home", "/customer/workouts", "/customer/updates"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(over, path).toBeLessThanOrEqual(0);
  }
  await page.goto("/customer/home");
  await expect(page.locator("li[data-status] button").first()).toBeVisible();
  const heights = await page.locator("li[data-status] button").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  expect(heights.length).toBeGreaterThan(0);
  for (const h of heights) expect(h).toBeGreaterThanOrEqual(43.5);
});
