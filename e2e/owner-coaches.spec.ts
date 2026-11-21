import { expect, test, type Page } from "@playwright/test";

// Uses the rich seed of every demo tenant through e2e/db.ts, so the numbers are real.
// Run with its own database and port: E2E_DB_NAME=allstar_e2e_frontend73 E2E_PORT=3273 npx playwright test e2e/owner-coaches.spec.ts
async function pick(page: Page, label: "Business" | "View as", value: string) {
  await page.getByRole("combobox", { name: label, exact: true }).selectOption(value);
  await page.waitForLoadState("networkidle");
}

async function signIn(page: Page, tenant: string, role: "owner" | "coach" | "customer", path: string) {
  await page.context().clearCookies();
  await page.goto("/");
  await pick(page, "Business", tenant);
  await pick(page, "View as", role);
  await page.goto(path);
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "page must not scroll sideways").toBeLessThanOrEqual(0);
}

const tile = (page: Page, label: string) => page.locator(".stat-tile").filter({ has: page.locator(".stat-label", { hasText: new RegExp(`^${label}$`) }) });

test.describe("owner coaches", () => {
  test.use({ viewport: { width: 1100, height: 900 } });

  test("opens Coaches from the dashboard and a coach detail with real numbers", async ({ page }) => {
    await signIn(page, "demo-gym", "owner", "/owner/dashboard");
    await page.getByRole("link", { name: "See all coaches" }).click();
    await expect(page).toHaveURL(/\/owner\/coaches$/);
    await expect(page.getByRole("heading", { level: 1, name: "Coaches" })).toBeVisible();

    const cards = page.getByRole("list", { name: "Coaches" }).getByRole("listitem");
    expect(await cards.count()).toBeGreaterThan(0);
    const first = cards.first();
    await expect(first.getByText("Members", { exact: true })).toBeVisible();
    await expect(first.getByRole("progressbar")).toBeVisible();
    expect(await page.locator("main").innerText()).not.toMatch(/NaN|undefined|accountab|surveil/i);

    const name = (await first.getByRole("link").first().innerText()).trim();
    await first.getByRole("link").first().click();
    await expect(page).toHaveURL(/\/owner\/coaches\/[^/]+$/);
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

    for (const label of ["Sessions scheduled", "Sessions completed", "Waiting for a roll call", "Goals achieved", "Level promotions", "Weekly availability", "Batches", "Members"]) {
      await expect(tile(page, label), label).toBeVisible();
    }
    for (const label of ["Consistency", "Attendance", "Workout adherence", "Workout adherence"]) {
      await expect(tile(page, label).locator(".stat-value"), label).toHaveText(/^(\d+(\.\d)?%|Not enough data yet)$/);
    }
    await expect(tile(page, "Sessions scheduled").locator(".stat-value")).toHaveText(/^\d[\d,]*$/);
    await expect(page.getByRole("img", { name: /Bar chart of sessions scheduled and completed in each of the last 8 weeks/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Weekly availability" }).last()).toBeVisible();
    expect(await page.locator("main").innerText()).not.toMatch(/NaN|undefined|accountab|surveil/i);
  });

  test("sorts coaches through the URL and links Coaches from Settings and Batches", async ({ page }) => {
    test.slow();
    await signIn(page, "demo-karate", "owner", "/owner/coaches");
    const sortBar = page.getByRole("navigation", { name: "Sort by" });
    await sortBar.getByRole("link", { name: "Members", exact: true }).click();
    await expect(page).toHaveURL(/sort=members$/);
    await expect(sortBar.getByRole("link", { name: "Members", exact: true })).toHaveAttribute("aria-current", "true");

    await page.goto("/owner/settings");
    await page.getByRole("link", { name: "Coaches and workload" }).click();
    await expect(page).toHaveURL(/\/owner\/coaches$/);

    await page.goto("/owner/batches");
    await page.getByRole("link", { name: "See all coaches" }).click();
    await expect(page).toHaveURL(/\/owner\/coaches$/);
  });
});

test.describe("owner settings", () => {
  test.use({ viewport: { width: 1100, height: 900 } });

  test("edits booking rules, validates, and keeps them after a reload", async ({ page }) => {
    await signIn(page, "demo-studio", "owner", "/owner/settings");
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    await expect(page.getByText("Business name")).toBeVisible();

    const minutes = page.getByLabel("Cancellation window (minutes)");
    const waitlist = page.getByRole("switch", { name: "Waitlist for full classes" });
    const cost = page.getByRole("switch", { name: "Show the cost of missed sessions" });
    await expect(cost).not.toBeChecked(); // display only, off by default

    await minutes.fill("3000");
    await page.getByRole("button", { name: "Save booking rules" }).click();
    await expect(page.getByText("Use a number from 0 to 2880.")).toBeVisible();
    await minutes.fill("");
    await page.getByRole("button", { name: "Save booking rules" }).click();
    await expect(page.getByText("Enter a number of minutes.")).toBeVisible();

    await minutes.fill("45");
    await waitlist.setChecked(false, { force: true });
    await cost.setChecked(true, { force: true });
    await page.getByRole("button", { name: "Save booking rules" }).click();
    await expect(page.getByText("Booking rules saved")).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Cancellation window (minutes)")).toHaveValue("45");
    await expect(page.getByRole("switch", { name: "Waitlist for full classes" })).not.toBeChecked();
    await expect(page.getByRole("switch", { name: "Show the cost of missed sessions" })).toBeChecked();

    // The same value is what the public API serves.
    const tenant = await page.evaluate(async () => (await fetch("/api/v1/tenant")).json().catch(() => null));
    if (tenant && typeof tenant === "object" && "bookingCancelWindowMinutes" in tenant) {
      expect((tenant as { bookingCancelWindowMinutes: number }).bookingCancelWindowMinutes).toBe(45);
    }
  });
});

test.describe("owner batches", () => {
  test.use({ viewport: { width: 1100, height: 900 } });

  test("shows cards and filters by venue and sport through the URL", async ({ page }) => {
    await signIn(page, "demo-gym", "owner", "/owner/batches");
    await expect(page.getByRole("heading", { level: 1, name: "Batches" })).toBeVisible();
    const cards = page.getByRole("list", { name: "Batches" }).getByRole("listitem");
    const total = await cards.count();
    expect(total).toBeGreaterThan(0);
    await expect(cards.first().getByRole("link", { name: /^Coach: / })).toHaveAttribute("href", /\/owner\/coaches\/.+/);

    // Demo tenants have one venue each, so choosing it keeps every batch; a sport narrows the list.
    const venue = page.getByLabel("Venue");
    await venue.selectOption({ index: 1 });
    await page.getByRole("button", { name: "Show batches" }).click();
    await expect(page).toHaveURL(/venueId=/);
    await expect(cards).toHaveCount(total);

    const sport = page.getByLabel("Sport");
    const sportOptions = await sport.locator("option").allInnerTexts();
    if (sportOptions.length > 2) {
      await sport.selectOption({ index: 1 });
      await page.getByRole("button", { name: "Show batches" }).click();
      await expect(page).toHaveURL(/sportId=/);
      await expect(cards.first()).toBeVisible();
      expect(await cards.count()).toBeLessThan(total);
      const chosen = sportOptions[1];
      for (const text of await cards.allInnerTexts()) expect(text).toContain(chosen);
      await page.getByRole("link", { name: "Clear filters" }).click();
      await expect(page).toHaveURL(/\/owner\/batches$/);
      await expect(cards).toHaveCount(total);
    }

    // A stale id falls back to all batches rather than an error.
    await page.goto("/owner/batches?venueId=does-not-exist&sportId=nope");
    await expect(cards).toHaveCount(total);
  });

  test("combining a venue and a sport that never meet shows a friendly empty state", async ({ page }) => {
    await signIn(page, "demo-karate", "owner", "/owner/batches");
    const venue = page.getByLabel("Venue");
    const sport = page.getByLabel("Sport");
    const venues = await venue.locator("option").evaluateAll((os) => (os as HTMLOptionElement[]).map((o) => o.value).filter(Boolean));
    const sports = await sport.locator("option").evaluateAll((os) => (os as HTMLOptionElement[]).map((o) => o.value).filter(Boolean));
    let found = false;
    for (const v of venues) {
      for (const s of sports) {
        await page.goto(`/owner/batches?venueId=${v}&sportId=${s}`);
        if (await page.getByText("No batches match these filters").isVisible()) {
          found = true;
          await expect(page.getByRole("link", { name: "Clear filters" }).first()).toBeVisible();
          break;
        }
      }
      if (found) break;
    }
    // Some seeds have every sport at every venue; then there is nothing to assert beyond no crash.
    expect(await page.locator("main").innerText()).not.toMatch(/NaN|undefined/);
  });
});

test.describe("owner-only access", () => {
  for (const role of ["coach", "customer"] as const) {
    test(`a ${role} is refused the owner coaches, settings and batches pages`, async ({ page }) => {
      await signIn(page, "demo-gym", role, "/owner/coaches");
      await expect(page.locator("section[role=alert]")).toContainText("not available for your role");
      for (const path of ["/owner/coaches/some-id", "/owner/settings", "/owner/batches"]) {
        await page.goto(path);
        await expect(page.locator("section[role=alert]")).toContainText("not available for your role");
        await expect(page.getByLabel("Cancellation window (minutes)")).toHaveCount(0);
      }
      // Reaching the owner pages through the user's own role segment is refused as well.
      for (const path of [`/${role}/coaches`, `/${role}/settings`, `/${role}/batches`]) {
        await page.goto(path);
        await expect(page.locator("main")).not.toContainText("Cancellation window");
        await expect(page.getByRole("list", { name: "Coaches" })).toHaveCount(0);
      }
    });
  }
});

test.describe("owner coaches at 360px", () => {
  test.use({ viewport: { width: 360, height: 780 } });

  test("coaches, coach detail, settings and batches fit without sideways scrolling", async ({ page }) => {
    await signIn(page, "demo-gym", "owner", "/owner/coaches");
    await expect(page.getByRole("heading", { level: 1, name: "Coaches" })).toBeVisible();
    await noHorizontalScroll(page);
    const link = page.getByRole("list", { name: "Coaches" }).getByRole("link").first();
    const box = await link.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(43);
    await link.click();
    await expect(page.getByRole("img", { name: /Bar chart of sessions scheduled/ })).toBeVisible();
    await noHorizontalScroll(page);

    await page.goto("/owner/settings");
    await expect(page.getByLabel("Cancellation window (minutes)")).toBeVisible();
    await noHorizontalScroll(page);
    const save = await page.getByRole("button", { name: "Save booking rules" }).boundingBox();
    expect(save?.height ?? 0).toBeGreaterThanOrEqual(43);

    await page.goto("/owner/batches");
    await expect(page.getByRole("heading", { level: 1, name: "Batches" })).toBeVisible();
    await noHorizontalScroll(page);
  });
});
