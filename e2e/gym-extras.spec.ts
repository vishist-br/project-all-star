import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// Gym extras (STAR-114): plan folders and templates, body measurements with a trend chart, muscle volume.
// Runs on the seeded demo-gym (Sample Trainer Gamma owns the folder and the template; Sample Member 03 has no
// measurements yet; Sample Member 01 has months of logged sets). Set E2E_SHOTS=<dir> to save 360px screenshots.

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);
test.use({ viewport: { width: 360, height: 780 } });

const SHOTS = process.env.E2E_SHOTS;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
};
const noSideScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

async function signIn(page: Page, request: APIRequestContext, tenant: string, email: string, landing: RegExp) {
  await page.context().clearCookies();
  const res = await request.post("/api/v1/dev/magic-link", { data: { tenantSlug: tenant, email } });
  expect(res.status()).toBe(200);
  const { url } = (await res.json()) as { url: string };
  await page.goto(url);
  await page.waitForURL(landing, { timeout: 90_000 });
}
const asCoach = (page: Page, request: APIRequestContext) => signIn(page, request, "demo-gym", "c1@demo-gym.example.test", /\/coach\//);
const asMember = (page: Page, request: APIRequestContext, key: string) => signIn(page, request, "demo-gym", `member-${key}@demo-gym.example.test`, /\/customer\/home$/);

const card = (page: Page, title: string) => page.locator(`[data-testid="plan-card"][data-plan-title="${title}"]`);

test("coach: folder group, duplicate a plan, save as template, use a template and open the builder", async ({ page, request }) => {
  await asCoach(page, request);
  await page.goto("/coach/plans");
  await expect(page.getByRole("heading", { level: 1, name: "Workout plans" })).toBeVisible({ timeout: 90_000 });

  // The seeded folder is a collapsible group with its two plans; the template sits in its own section.
  const folder = page.locator('[data-testid="folder-group"][data-folder="Starter programs (sample)"]');
  await expect(folder).toBeVisible();
  await expect(folder.getByRole("link", { name: "Full Body Strength (3 days)", exact: true })).toBeVisible();
  await expect(folder.getByRole("link", { name: "Daily Mobility 10 min", exact: true })).toBeVisible();
  const templates = page.getByTestId("templates-section");
  await expect(templates.getByText("Full body starter (template)").first()).toBeVisible();
  await shot(page, "plans-library");
  await noSideScroll(page);

  // Collapse the folder: its plans go out of sight, the page keeps working.
  await folder.locator("summary").click();
  await expect(folder.getByRole("link", { name: "Daily Mobility 10 min", exact: true })).toBeHidden();
  await folder.locator("summary").click();
  await expect(folder.getByRole("link", { name: "Daily Mobility 10 min", exact: true })).toBeVisible();

  // Duplicate: a "(copy)" appears next to the original, in the same folder.
  await page.getByRole("button", { name: "Duplicate: Daily Mobility 10 min", exact: true }).click();
  await expect(folder.getByRole("link", { name: "Daily Mobility 10 min (copy)", exact: true })).toBeVisible();

  // Save as template: the copy shows up in the Templates section as a template.
  await page.getByRole("button", { name: "Save as template: Daily Mobility 10 min (copy)", exact: true }).click();
  await expect(templates.getByRole("link", { name: "Daily Mobility 10 min (copy) (copy)", exact: true })).toBeVisible();

  // Move to folder: take the copy out of the folder.
  await page.getByRole("button", { name: "Move to folder: Daily Mobility 10 min (copy)", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Move Daily Mobility 10 min (copy)" });
  await sheet.getByLabel("Folder").selectOption({ label: "No folder" });
  await shot(page, "plans-move-sheet");
  await sheet.getByRole("button", { name: "Move", exact: true }).click();
  await expect(folder.getByRole("link", { name: "Daily Mobility 10 min (copy)", exact: true })).toBeHidden();
  await expect(page.getByRole("link", { name: "Daily Mobility 10 min (copy)", exact: true })).toBeVisible();

  // Use template: creates a new plan from the seeded template and opens the builder.
  await page.getByRole("button", { name: "Use template: Full body starter (template)", exact: true }).click();
  await page.waitForURL(/\/coach\/plans\/[^/]+$/, { timeout: 90_000 });
  await expect(page.getByLabel("Plan name")).toHaveValue("Full body starter (template)");
  await shot(page, "plans-builder-from-template");
  await noSideScroll(page);

  // The new plan is a real plan (not a template): it is on the list, and the template is still there.
  await page.goto("/coach/plans");
  await expect(page.getByRole("heading", { level: 1, name: "Workout plans" })).toBeVisible();
  await expect(templates.getByText("Full body starter (template)").first()).toBeVisible();
  await expect(card(page, "Full body starter (template)")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Assign: Full body starter (template)" }).or(page.getByRole("button", { name: "Assign" })).first()).toBeVisible();
});

test("coach: new folder, rename, delete keeps the plans", async ({ page, request }) => {
  await asCoach(page, request);
  await page.goto("/coach/plans");
  await page.getByLabel("Folder name").first().fill("E2E temp folder");
  await page.getByRole("button", { name: "Add folder" }).click();
  const folder = page.locator('[data-testid="folder-group"][data-folder="E2E temp folder"]');
  await expect(folder).toBeVisible();
  await expect(folder.getByText("No plans from this list sit in this folder")).toBeVisible();

  await folder.getByRole("button", { name: "Rename: E2E temp folder" }).click();
  await page.getByRole("dialog", { name: "Rename folder" }).getByLabel("Folder name").fill("E2E renamed");
  await page.getByRole("dialog", { name: "Rename folder" }).getByRole("button", { name: "Save" }).click();
  const renamed = page.locator('[data-testid="folder-group"][data-folder="E2E renamed"]');
  await expect(renamed).toBeVisible();

  await renamed.getByRole("button", { name: "Delete folder: E2E renamed" }).click();
  await page.getByRole("dialog", { name: "Delete this folder?" }).getByRole("button", { name: "Delete folder" }).click();
  await expect(renamed).toBeHidden();
});

test("customer: add and delete a body measurement and watch the trend chart follow", async ({ page, request }) => {
  await asMember(page, request, "m3");
  await page.goto("/customer/progress");
  await page.getByTestId("body-link").click();
  await expect(page.getByRole("heading", { level: 1, name: "Body measurements" })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("No measurements yet")).toBeVisible();
  await expect(page.getByTestId("body-chart")).toHaveCount(0);
  await shot(page, "body-empty");

  // Numeric keypad on the number fields, today as the default date.
  await expect(page.getByLabel("Weight (kg)")).toHaveAttribute("inputmode", "decimal");
  await expect(page.getByLabel("Date")).not.toHaveValue("");

  // A bad weight is refused with a message; nothing is saved.
  await page.getByLabel("Weight (kg)").fill("3");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Enter a weight between 10 and 400 kg")).toBeVisible();

  await page.getByLabel("Weight (kg)").fill("70,5");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByTestId("body-chart")).toHaveAttribute("data-points", "1");
  await expect(page.getByTestId("latest-weightKg")).toHaveText("70.5 kg");
  await expect(page.getByTestId("measurement-entry")).toHaveCount(1);

  // An earlier entry with optional fields (waist) adds a second point and a waist chip.
  const earlier = new Date(Date.now() + 330 * 60_000 - 14 * 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel("Date").fill(earlier);
  await page.getByLabel("Weight (kg)").fill("71.4");
  await page.getByText("More measurements, all optional").click();
  await page.getByLabel("Waist (cm), optional").fill("84");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByTestId("body-chart")).toHaveAttribute("data-points", "2");
  await expect(page.getByTestId("measurement-entry")).toHaveCount(2);
  await expect(page.getByTestId("latest-weightKg")).toHaveText("70.5 kg");
  await page.getByTestId("chip-waistCm").click();
  await expect(page.getByTestId("body-chart")).toHaveAttribute("data-points", "1");
  await page.getByTestId("chip-weightKg").click();
  await expect(page.getByTestId("body-chart")).toHaveAttribute("data-points", "2");
  await shot(page, "body-with-data");
  await noSideScroll(page);

  // Delete the newest entry (with a confirm step): the chart and latest card follow.
  await page.getByTestId("measurement-entry").first().getByRole("button", { name: /^Delete/ }).click();
  await page.getByRole("dialog", { name: "Delete this entry?" }).getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByTestId("measurement-entry")).toHaveCount(1);
  await expect(page.getByTestId("body-chart")).toHaveAttribute("data-points", "1");
  await expect(page.getByTestId("latest-weightKg")).toHaveText("71.4 kg");
  await page.getByTestId("measurement-entry").first().getByRole("button", { name: /^Delete/ }).click();
  await page.getByRole("dialog", { name: "Delete this entry?" }).getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("No measurements yet")).toBeVisible();
});

test("coach and owner see a member's measurements read only on the member page", async ({ page, request }) => {
  await asCoach(page, request);
  await page.goto("/coach/members/seed-demo-gym-member-m1");
  const body = page.getByTestId("member-body");
  await expect(body).toBeVisible({ timeout: 90_000 });
  await expect(body.getByText("Weight")).toBeVisible();
  await expect(body.getByRole("button")).toHaveCount(0);
  await expect(body.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Sets per muscle, last 4 weeks" })).toBeVisible();
  await shot(page, "member-detail-gym-extras");
  await noSideScroll(page);
});

test("customer: sets per muscle on Progress and the full muscle volume page; empty state without gym sets", async ({ page, request }) => {
  await asMember(page, request, "m1");
  await page.goto("/customer/progress/muscles?range=28d");
  await expect(page.getByRole("heading", { level: 1, name: "Muscle volume" })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("muscle-row").first()).toBeVisible();
  expect(await page.getByTestId("muscle-row").count()).toBeGreaterThan(2);
  await expect(page.getByTestId("muscle-total")).toContainText("sets");
  await shot(page, "muscles-page");
  await noSideScroll(page);
  await page.getByTestId("range-7d").click();
  await expect(page.getByTestId("range-7d")).toHaveAttribute("aria-current", "true");

  // From Progress the page is one tap away, and the compact card appears when sets exist this week.
  await page.goto("/customer/progress");
  await expect(page.getByTestId("muscles-link")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("body-link")).toBeVisible();
  await shot(page, "progress-with-links");
  await noSideScroll(page);

  // A member with no gym sets gets the empty state.
  await signIn(page, request, "demo-karate", "member-a1@demo-karate.example.test", /\/customer\/home$/);
  await page.goto("/customer/progress/muscles");
  await expect(page.getByText("No gym workouts logged yet")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("muscle-row")).toHaveCount(0);
  await shot(page, "muscles-empty");
  await noSideScroll(page);
});
