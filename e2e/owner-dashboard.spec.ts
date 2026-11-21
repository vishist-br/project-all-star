import { expect, test, type Page } from "@playwright/test";

// Uses the rich seed (`npm run db:seed`) of every demo tenant through e2e/db.ts, so the numbers are real.
// Run with its own database and port: E2E_DB_NAME=allstar_e2e_frontend72 E2E_PORT=3272 npx playwright test e2e/owner-dashboard.spec.ts
const TENANTS = ["demo-karate", "demo-gym", "demo-studio"] as const;

async function pick(page: Page, label: "Business" | "View as", value: string) {
  await page.getByRole("combobox", { name: label, exact: true }).selectOption(value);
  await page.waitForLoadState("networkidle");
}

async function signInAsOwner(page: Page, tenant: string) {
  await page.context().clearCookies();
  await page.goto("/");
  await pick(page, "Business", tenant);
  await pick(page, "View as", "owner");
  await page.goto("/owner/dashboard");
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "page must not scroll sideways").toBeLessThanOrEqual(0);
}

const tile = (page: Page, label: string) => page.locator(".stat-tile").filter({ has: page.locator(".stat-label", { hasText: new RegExp(`^${label}$`) }) });

for (const tenant of TENANTS) {
  test.describe(`owner dashboard, ${tenant}`, () => {
    test.use({ viewport: { width: 1100, height: 900 } });

    test("shows KPI tiles, charts and insight cards with real numbers", async ({ page }) => {
      await signInAsOwner(page, tenant);
      await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();

      // KPI tiles: a real count for active members, "x of y" sessions, percentages elsewhere.
      await expect(tile(page, "Active members").locator(".stat-value")).toHaveText(/^\d[\d,]*$/);
      await expect(tile(page, "Sessions completed").locator(".stat-value")).toHaveText(/^\d+ of \d+$/);
      for (const label of ["Attendance", "No-show rate", "Retention", "Workout adherence", "Engagement"]) {
        await expect(tile(page, label), label).toBeVisible();
        // Either a real percentage or the empty state, never a bare 0 stand-in for "no data".
        await expect(tile(page, label).locator(".stat-value"), label).toHaveText(/^(\d+(\.\d)?%|Not enough data yet)$/);
      }
      expect(await tile(page, "Active members").locator(".stat-value").innerText()).not.toBe("0");

      // Charts are labelled images with a hidden data table.
      for (const name of [/Line chart of active members/, /Bar chart of sessions scheduled and completed/, /Heatmap of attendance percentage for each weekday/, /Donut chart of active members by fee status/]) {
        await expect(page.getByRole("img", { name }).first(), String(name)).toBeVisible();
      }
      await expect(page.locator("figure table").first()).toBeAttached();

      // Insight cards render translated text, not raw keys.
      const cards = page.getByRole("list", { name: "Insights" }).getByRole("listitem");
      expect(await cards.count()).toBeGreaterThan(0);
      for (const text of await cards.allInnerTexts()) {
        expect(text).not.toMatch(/insights\.card|\{\w+\}|undefined|NaN/);
        expect(text.length).toBeGreaterThan(15);
      }

      // Side panels, fee note (counts only) and links.
      await expect(page.getByRole("heading", { name: "Friendly check-ins" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Renewal alerts" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Sessions without a roll call" })).toBeVisible();
      await expect(page.getByText("No amounts are tracked")).toBeVisible();
      await expect(page.getByRole("link", { name: "Workout plans" })).toHaveAttribute("href", "/owner/plans");
      await expect(page.getByRole("link", { name: "See all coaches" })).toHaveAttribute("href", "/owner/coaches");

      const body = await page.locator("main").innerText();
      expect(body).not.toMatch(/NaN|undefined|accountab|surveil|revenue/i);
    });

    test("changes the date range through the URL", async ({ page }) => {
      await signInAsOwner(page, tenant);
      const group = page.getByRole("navigation", { name: "Date range" });
      await expect(group.getByRole("link", { name: "Last 30 days" })).toHaveAttribute("aria-current", "true");
      const before = await tile(page, "Sessions completed").locator(".stat-value").innerText();

      await group.getByRole("link", { name: "Last 7 days" }).click();
      await expect(page).toHaveURL(/range=7$/);
      await expect(group.getByRole("link", { name: "Last 7 days" })).toHaveAttribute("aria-current", "true");
      const week = await tile(page, "Sessions completed").locator(".stat-value").innerText();
      expect(week).toMatch(/^\d+ of \d+$|^Not enough data yet$/);

      await group.getByRole("link", { name: "Last 90 days" }).click();
      await expect(page).toHaveURL(/range=90$/);
      const quarter = await tile(page, "Sessions completed").locator(".stat-value").innerText();
      expect(quarter).toMatch(/^\d+ of \d+$/);
      expect(Number(quarter.split(" of ")[1])).toBeGreaterThanOrEqual(Number(before.split(" of ")[1]));
    });

    test("fits a 360px phone without sideways scrolling", async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 780 });
      await signInAsOwner(page, tenant);
      await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
      await expect(page.getByRole("img", { name: /Line chart of active members/ })).toBeVisible();
      await noHorizontalScroll(page);
      await page.getByRole("link", { name: "Last 90 days" }).click();
      await expect(page).toHaveURL(/range=90$/);
      await noHorizontalScroll(page);
    });
  });
}

test("owner can open workout plans from the dashboard, and a customer cannot see the dashboard", async ({ page }) => {
  await signInAsOwner(page, "demo-gym");
  await page.getByRole("link", { name: "Workout plans" }).click();
  await expect(page).toHaveURL(/\/owner\/plans$/);
  await expect(page.getByRole("heading", { level: 1, name: "Workout plans" })).toBeVisible();

  await page.context().clearCookies();
  await page.goto("/");
  await pick(page, "Business", "demo-gym");
  await pick(page, "View as", "customer");
  await page.goto("/owner/dashboard");
  await expect(page.locator("section[role=alert]")).toContainText("not available for your role");
});
