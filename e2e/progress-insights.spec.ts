import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// Exercise progress, belts and skills, owner class insights (STAR-112). Uses the rich seed.
// Run: E2E_WEBPACK=1 E2E_DB_NAME=star112_e2e E2E_PORT=3512 npx playwright test e2e/progress-insights.spec.ts
// Set SHOTS_DIR to also save 360px screenshots.

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);
const SHOTS = process.env.SHOTS_DIR;

type U = { tenant: string; email: string };
const GYM_MEMBER: U = { tenant: "demo-gym", email: "member-m1@demo-gym.example.test" };
const GYM_COACH: U = { tenant: "demo-gym", email: "c1@demo-gym.example.test" };
const GYM_OWNER: U = { tenant: "demo-gym", email: "owner@demo-gym.example.test" };
const KARATE_PARENT: U = { tenant: "demo-karate", email: "parent-g1@demo-karate.example.test" };
const KARATE_COACH: U = { tenant: "demo-karate", email: "c1@demo-karate.example.test" };

async function signIn(page: Page, request: APIRequestContext, u: U, locale = "en") {
  await page.context().clearCookies();
  const res = await request.post("/api/v1/dev/magic-link", { data: { tenantSlug: u.tenant, email: u.email } });
  expect(res.status()).toBe(200);
  const { url } = (await res.json()) as { url: string };
  await page.goto(url);
  await expect(page).toHaveURL(/\/(customer|coach|owner)\/[a-z]+/);
  await page.context().addCookies([{ name: "locale", value: locale, url: page.url() }]);
}

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function noSideScroll(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, "page must not scroll sideways").toBeLessThanOrEqual(0);
}

test("customer exercise page: tabs, range, metric chips, records, history, how to", async ({ page, request }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await signIn(page, request, GYM_MEMBER);

  // Reachable from Progress > Exercise history.
  await page.goto("/customer/progress");
  await page.getByTestId("exercises-link").click();
  await expect(page.getByRole("heading", { level: 1, name: "Your exercises" })).toBeVisible();
  await shot(page, "customer-exercises-list-360");
  await page.getByTestId("exercise-row").filter({ hasText: "Barbell Squat" }).first().click();

  await expect(page.getByRole("heading", { level: 1 })).toContainText("Barbell Squat");
  const tabs = page.getByRole("tablist", { name: "Exercise sections" });
  await expect(tabs.getByRole("tab")).toHaveText(["Progress", "History", "How to"]);
  await expect(tabs.getByRole("tab", { name: "Progress" })).toHaveAttribute("aria-selected", "true");

  // Headline tiles and the chart.
  await expect(page.getByTestId("tile-best")).toContainText(/Best weight/);
  await expect(page.getByTestId("tile-best")).toContainText(/\d+ kg/);
  await expect(page.getByTestId("tile-max")).toContainText("Est. max");
  await expect(page.getByTestId("tile-sessions")).toContainText("Sessions");
  await expect(page.getByTestId("exercise-chart")).toBeVisible();
  await expect(page.getByRole("img", { name: /Line chart of Weight for Barbell Squat/ })).toBeVisible();
  await expect(page.getByTestId("chart-caption")).toContainText(/Weight, \w+ to \w+|Weight, \d/);
  // A table-equivalent exists for screen readers.
  await expect(page.locator("figure table tbody tr").first()).toBeAttached();
  await expect(page.getByTestId("rep-records")).toContainText(/\d+ reps/);
  await expect(page.getByRole("heading", { name: "Your best at each rep count" })).toBeVisible();
  await noSideScroll(page);
  await shot(page, "customer-exercise-progress-360");

  // Metric chips: five for weight and reps, one selected, selection is in the URL.
  const chips = page.getByRole("navigation", { name: "Chart metric" }).getByRole("link");
  await expect(chips).toHaveText(["Weight", "Est. max", "Set volume", "Volume", "Reps"]);
  await expect(page.getByTestId("metric-heaviestWeight")).toHaveAttribute("aria-current", "true");
  await page.getByTestId("metric-oneRepMax").click();
  await expect(page).toHaveURL(/metric=oneRepMax/);
  await expect(page.getByTestId("metric-oneRepMax")).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("img", { name: /Line chart of Est\. max/ })).toBeVisible();

  // Range links.
  await page.getByTestId("range-1y").click();
  await expect(page).toHaveURL(/range=1y/);
  await expect(page.getByTestId("range-1y")).toHaveAttribute("aria-current", "true");

  // History: newest first, set type chips.
  await tabs.getByRole("tab", { name: "History" }).click();
  await expect(page).toHaveURL(/tab=history/);
  await expect(tabs.getByRole("tab", { name: "History" })).toHaveAttribute("aria-selected", "true");
  const sessions = page.getByTestId("history-list").locator("> li");
  expect(await sessions.count()).toBeGreaterThan(3);
  await expect(page.getByTestId("history-list")).toContainText(/Warm-up/);
  await expect(page.getByTestId("history-list").locator("li").first()).toContainText(/\d+(\.\d)? kg x \d+/);
  await noSideScroll(page);
  await shot(page, "customer-exercise-history-360");

  // How to: placeholder box, instructions, muscles.
  await tabs.getByRole("tab", { name: "How to" }).click();
  await expect(page.getByTestId("demo-placeholder")).toBeVisible();
  await expect(page.getByRole("heading", { name: "How to do it" })).toBeVisible();
  await noSideScroll(page);
  await shot(page, "customer-exercise-howto-360");

  // Shareable: a deep link opens the same view without client state.
  await page.goto(page.url().replace(/tab=howto/, "tab=history"));
  await expect(page.getByTestId("history-list")).toBeVisible();
});

test("customer sees the belt card and the skills page", async ({ page, request }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await signIn(page, request, KARATE_PARENT);
  await page.goto("/customer/progress");
  const card = page.getByTestId("belt-card");
  await expect(card).toBeVisible();
  await expect(page.getByTestId("belt-next")).toContainText("Next belt: Yellow");
  await expect(page.getByTestId("belt-count")).toHaveText("3 of 6 skills");
  await expect(card.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
  await expect(page.getByTestId("belt-left")).toContainText("Left to sign off");
  await noSideScroll(page);
  await shot(page, "customer-belt-card-360");

  await page.getByTestId("skills-link").click();
  await expect(page.getByRole("heading", { level: 1, name: "Belts and skills" })).toBeVisible();
  await expect(page.locator('li[data-signed="true"]')).toHaveCount(3);
  await expect(page.getByText("Not signed off yet").first()).toBeVisible();
  await noSideScroll(page);
  await shot(page, "customer-skills-360");

  // Hindi draft renders without overflow.
  await signIn(page, request, KARATE_PARENT, "hi");
  await page.goto("/customer/progress");
  await expect(page.getByTestId("belt-card")).toBeVisible();
  await noSideScroll(page);
  await shot(page, "customer-belt-card-hi-360");
  await page.goto("/customer/progress/skills");
  await noSideScroll(page);
  await shot(page, "customer-skills-hi-360");
});

test("a coach signs off a skill and clears it", async ({ page, request }) => {
  await page.setViewportSize({ width: 360, height: 900 });
  await signIn(page, request, KARATE_COACH);
  await page.goto("/coach/members");
  await page.getByRole("link", { name: /Sample Kid 01/ }).first().click();
  // The member page compiles on first visit in `next dev`: wait for it rather than for the default 5 s.
  await expect(page).toHaveURL(/\/coach\/members\/[^/]+$/, { timeout: 60_000 });
  const section = page.getByTestId("skills-section");
  await expect(section).toBeVisible({ timeout: 30_000 });
  const todo = section.locator('li[data-signed="false"]').first();
  const name = (await todo.locator("p").first().textContent()) ?? "";
  const count = section.getByText(/^\d of \d skills$/).first();
  const before = await count.textContent();
  await todo.getByRole("button", { name: /^3/ }).click();
  await expect(page.getByText(`Signed off: ${name}`)).toBeVisible();
  await expect(section.locator('li[data-signed="true"]').filter({ hasText: name })).toBeVisible();
  await expect(count).not.toHaveText(before ?? "");
  await expect(section.locator('li[data-signed="true"]').filter({ hasText: name }).getByRole("button", { name: /^3/ })).toHaveAttribute("aria-pressed", "true");
  await noSideScroll(page);
  await shot(page, "coach-skills-360");

  // Clear it again.
  await section.locator('li[data-signed="true"]').filter({ hasText: name }).getByRole("button", { name: /Clear/ }).click();
  await expect(page.getByText(`Cleared: ${name}`)).toBeVisible();
  await expect(section.locator('li[data-signed="false"]').filter({ hasText: name })).toBeVisible();
});

test("coach opens an exercise and picks a member", async ({ page, request }) => {
  await page.setViewportSize({ width: 360, height: 900 });
  await signIn(page, request, GYM_COACH);
  await page.goto("/coach/workouts?q=Barbell%20Squat");
  await page.getByText("Barbell Squat", { exact: true }).first().click();
  await page.getByRole("link", { name: "Open exercise page" }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Barbell Squat");
  await expect(page.getByLabel("Member")).toBeVisible();
  await expect(page.getByTestId("exercise-chart")).toBeVisible();
  await noSideScroll(page);
  await shot(page, "coach-exercise-360");
});

test("owner class insights", async ({ page, request }) => {
  await page.setViewportSize({ width: 360, height: 900 });
  await signIn(page, request, GYM_OWNER);

  // Reachable from the nav (More page on phones) and from the dashboard.
  await page.goto("/owner/dashboard");
  await page.getByTestId("insights-link").click();
  await expect(page).toHaveURL(/\/owner\/insights$/);
  await expect(page.getByRole("heading", { level: 1, name: "Class insights" })).toBeVisible();
  await expect(page.getByTestId("tile-fill")).toContainText("Average fill");
  await expect(page.getByTestId("tile-fill")).toContainText(/\d+%/);
  await expect(page.getByTestId("tile-attendance")).toContainText("Attendance");
  await expect(page.getByTestId("tile-workout")).toContainText("Classes with a workout sent");
  expect(await page.getByTestId("class-slot").count()).toBeGreaterThan(0);
  await expect(page.getByTestId("class-slot").first().getByRole("progressbar")).toBeVisible();
  await expect(page.getByTestId("class-slot").first()).toContainText(/Usually \d+ of \d+ places filled|No classes held/);
  await expect(page.getByTestId("suggestions")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Suggestions" })).toBeVisible();
  await noSideScroll(page);
  await shot(page, "owner-insights-360");

  await page.getByTestId("range-7d").click();
  await expect(page).toHaveURL(/range=7d/);
  await expect(page.getByTestId("range-7d")).toHaveAttribute("aria-current", "true");

  await page.goto("/owner/more");
  await expect(page.getByRole("link", { name: /Class insights/ })).toBeVisible();

  await signIn(page, request, GYM_OWNER, "hi");
  await page.goto("/owner/insights");
  await noSideScroll(page);
  await shot(page, "owner-insights-hi-360");

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/owner/insights");
  await shot(page, "owner-insights-1280");
});
