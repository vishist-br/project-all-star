import { expect, test, type Page } from "@playwright/test";

async function pick(page: Page, label: "Business" | "View as", value: string) {
  await page.getByRole("combobox", { name: label, exact: true }).selectOption(value);
  await page.waitForLoadState("networkidle");
}

async function signInAs(page: Page, tenant: string, role: "coach" | "customer") {
  await page.context().clearCookies();
  await page.goto("/");
  await pick(page, "Business", tenant);
  await pick(page, "View as", role);
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "page must not scroll sideways").toBeLessThanOrEqual(0);
}

test.describe("coach plans", () => {
  test.use({ viewport: { width: 360, height: 780 } });

  test("create, assign, edit, conflict, archive and role guard", async ({ page, browser }) => {
    const name = `E2E Strength ${Date.now()}`;
    await signInAs(page, "demo-gym", "coach");

    // Nav entry and list.
    await page.goto("/coach");
    await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Plans" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Workout plans" })).toBeVisible();
    await noHorizontalScroll(page);

    // Builder with the exercise picker (real catalog).
    await page.getByRole("link", { name: "New plan" }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: "New plan" })).toBeVisible();
    await page.getByLabel("Plan name").fill(name);
    await page.getByRole("button", { name: /Add exercises/ }).click();
    const picker = page.getByRole("dialog", { name: "Add exercises" });
    await picker.getByLabel("Search exercises").fill("squat");
    const firstAdd = picker.getByRole("button", { name: /^Add / }).first();
    await expect(firstAdd).toBeVisible();
    await firstAdd.click();
    await picker.getByRole("button", { name: "Done" }).click();
    await expect(page.getByLabel("Sets")).toHaveValue("3");
    await page.getByLabel("Reps").fill("12");
    await noHorizontalScroll(page);

    // Client validation: an empty title is refused with a message.
    await page.getByLabel("Plan name").fill("");
    await page.getByRole("button", { name: "Save and activate" }).click();
    await expect(page.getByText("This is required.")).toBeVisible();
    await page.getByLabel("Plan name").fill(name);

    await page.getByRole("button", { name: "Save and activate" }).click();
    await expect(page).toHaveURL(/\/coach\/plans$/);
    const card = page.getByRole("listitem").filter({ hasText: name });
    await expect(card).toBeVisible();
    await expect(card).toContainText("Active");
    await expect(card).toContainText("1 exercises");

    // Assign to a member of the coach's own batches.
    await card.getByRole("button", { name: "Assign" }).click();
    const sheet = page.getByRole("dialog", { name: /Assign:/ });
    await sheet.getByRole("checkbox").first().check();
    await sheet.getByRole("button", { name: "Assign plan" }).click();
    await expect(page.getByText(/Plan assigned to 1 members/)).toBeVisible();

    // Assigning the same member again reports a per-member problem.
    await card.getByRole("button", { name: "Assign" }).click();
    const again = page.getByRole("dialog", { name: /Assign:/ });
    await again.getByRole("checkbox").first().check();
    await again.getByRole("button", { name: "Assign plan" }).click();
    await expect(again.getByText("Already has this plan")).toBeVisible();
    await again.getByRole("button", { name: "Close" }).last().click();

    // It persists after a reload.
    await page.reload();
    const reloaded = page.getByRole("listitem").filter({ hasText: name });
    await expect(reloaded).toContainText("1 members assigned");

    // Edit and save; the new name persists.
    await reloaded.getByRole("link", { name: "Edit" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Edit plan" })).toBeVisible();
    await expect(page.getByLabel("Plan name")).toHaveValue(name);
    const editUrl = page.url();

    // A second session saves first: the first one then sees the friendly conflict state.
    const other = await browser.newPage({ viewport: { width: 360, height: 780 } });
    await other.context().addCookies(await page.context().cookies());
    await other.goto(editUrl);
    await other.getByLabel("Plan name").fill(`${name} v2`);
    await other.getByRole("button", { name: "Save and activate" }).click();
    await expect(other).toHaveURL(/\/coach\/plans$/);
    await other.close();

    await page.getByLabel("Plan name").fill(`${name} mine`);
    await page.getByRole("button", { name: "Save and activate" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Someone changed this plan" })).toBeVisible();
    await page.getByRole("button", { name: "Reload plan" }).click();
    await expect(page.getByLabel("Plan name")).toHaveValue(`${name} v2`);

    await page.getByLabel("Plan name").fill(`${name} v3`);
    await page.getByRole("button", { name: "Save and activate" }).click();
    await expect(page).toHaveURL(/\/coach\/plans$/);
    await page.reload();
    await expect(page.getByRole("listitem").filter({ hasText: `${name} v3` })).toBeVisible();

    // Archive needs a confirm step.
    const v3 = page.getByRole("listitem").filter({ hasText: `${name} v3` });
    await v3.getByRole("button", { name: "Archive" }).click();
    const confirm = page.getByRole("dialog", { name: "Archive this plan?" });
    await confirm.getByText("Keep plan", { exact: true }).click();
    await expect(v3).toContainText("Active");
    await v3.getByRole("button", { name: "Archive" }).click();
    await page.getByRole("dialog", { name: "Archive this plan?" }).getByRole("button", { name: "Archive plan" }).click();
    await expect(page.getByText("Plan archived")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("listitem").filter({ hasText: `${name} v3` })).toContainText("Archived");

    // Status filter.
    await page.goto("/coach/plans?status=archived");
    await expect(page.getByRole("listitem").filter({ hasText: `${name} v3` })).toBeVisible();
    await page.goto("/coach/plans?status=draft&q=zzzz-nothing");
    await expect(page.getByText("No plans match these filters.")).toBeVisible();
  });

  test("a customer cannot reach the plan screens", async ({ page }) => {
    await signInAs(page, "demo-gym", "customer");
    for (const path of ["/coach/plans", "/coach/plans/new"]) {
      await page.goto(path);
      await expect(page.locator("section[role=alert]"), path).toContainText("not available for your role");
      await expect(page.locator('nav a[href^="/coach"]'), path).toHaveCount(0);
    }
  });
});
