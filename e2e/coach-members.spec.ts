import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { scratchUrl } from "./db";

// Coach roster, member detail, owner member detail and My record (STAR-71), on the rich demo seed.
// demo-gym: coach "Sample Trainer Gamma" (c1) runs Morning/Evening (members 01-04, 07, 08 ...);
// "Sample Trainer Delta" (c2) runs the personal-training slot (members 05 and 06).

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

const OWN = "Sample Member 02"; // Gamma's member who does not yet have the mobility plan
const OTHER = "Sample Member 05"; // Delta's member
const PLAN = "Daily Mobility 10 min";

async function pick(page: Page, label: "Business" | "View as", value: string) {
  await page.getByRole("combobox", { name: label, exact: true }).selectOption(value);
  await page.waitForLoadState("networkidle");
}

async function signInAs(page: Page, tenant: string, role: "owner" | "coach" | "customer") {
  await page.context().clearCookies();
  await page.goto("/");
  await pick(page, "Business", tenant);
  await pick(page, "View as", role);
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "page must not scroll sideways").toBeLessThanOrEqual(0);
}

async function memberId(name: string): Promise<string> {
  const prisma = new PrismaClient({ datasources: { db: { url: scratchUrl() } } });
  try {
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: "demo-gym" }, select: { id: true } });
    const m = await prisma.member.findFirstOrThrow({ where: { tenantId: tenant.id, displayName: name }, select: { id: true } });
    return m.id;
  } finally {
    await prisma.$disconnect();
  }
}

test.describe("coach members at 360px", () => {
  test.use({ viewport: { width: 360, height: 780 } });

  test("roster, member detail, goal, plan, sign-in link and customer sync", async ({ page, browser }) => {
    const goalTitle = `E2E sessions goal ${Date.now()}`;
    await signInAs(page, "demo-gym", "coach");

    // Roster via the nav (Members stays in the bar).
    await page.goto("/coach");
    await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Members" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Members" })).toBeVisible();
    await expect(page.getByRole("link", { name: `Open ${OWN}` })).toBeVisible();
    await expect(page.getByRole("link", { name: `Open ${OTHER}` })).toHaveCount(0);
    await noHorizontalScroll(page);

    // Search narrows the list.
    await page.getByRole("searchbox", { name: "Search members" }).fill("02");
    await page.getByRole("button", { name: "Show" }).click();
    await expect(page.getByRole("link", { name: `Open ${OWN}` })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open Sample Member 01" })).toHaveCount(0);
    await page.getByRole("searchbox", { name: "Search members" }).fill("zzzz-nobody");
    await page.getByRole("button", { name: "Show" }).click();
    await expect(page.getByText("No members match these filters.")).toBeVisible();

    // Open a member.
    await page.goto("/coach/members?q=02");
    await page.getByRole("link", { name: `Open ${OWN}` }).click();
    await expect(page.getByRole("heading", { level: 1, name: OWN })).toBeVisible();
    await expect(page.getByRole("link", { name: "Schedule a session" })).toHaveAttribute("href", /\/coach\/sessions\/new\?memberId=/);
    await expect(page.getByText("Excused absences and holidays are never counted as missed.")).toBeVisible();
    await noHorizontalScroll(page);
    const detailUrl = page.url();

    // Create a goal.
    await page.getByRole("button", { name: "New goal" }).first().click();
    const goalDialog = page.getByRole("dialog", { name: "New goal" });
    await goalDialog.getByRole("button", { name: "Save goal" }).click();
    await expect(goalDialog.getByText("This is required.").first()).toBeVisible();
    await goalDialog.getByLabel("Goal title").fill(goalTitle);
    await goalDialog.getByLabel("Target", { exact: true }).fill("30");
    await goalDialog.getByRole("button", { name: "Save goal" }).click();
    await expect(page.getByText("Goal saved")).toBeVisible();
    const goalItem = page.getByRole("list", { name: "Goals", exact: true }).getByRole("listitem").filter({ hasText: goalTitle });
    await expect(goalItem).toContainText("Active");
    await expect(goalItem).toContainText("% of the way there");
    await noHorizontalScroll(page);

    // Mark it achieved.
    await goalItem.getByRole("button", { name: "Mark achieved" }).click();
    await expect(page.getByRole("list", { name: "Goals", exact: true }).getByRole("listitem").filter({ hasText: goalTitle })).toContainText("Achieved");

    // Assign a plan, then pause and resume it.
    await page.getByRole("button", { name: "Assign a plan" }).first().click();
    const assign = page.getByRole("dialog", { name: `Assign a plan to ${OWN}` });
    await assign.getByRole("button", { name: "Assign plan" }).click();
    await expect(assign.getByText("Choose a plan.")).toBeVisible();
    await assign.getByLabel("Plan", { exact: true }).selectOption({ label: PLAN });
    await assign.getByRole("button", { name: "Assign plan" }).click();
    await expect(page.getByText("Plan assigned")).toBeVisible();
    const planItem = page.getByRole("list", { name: "Workout plans", exact: true }).getByRole("listitem").filter({ hasText: PLAN });
    await expect(planItem).toContainText("Active");
    await planItem.getByRole("button", { name: "Pause" }).click();
    await expect(page.getByRole("list", { name: "Workout plans", exact: true }).getByRole("listitem").filter({ hasText: PLAN })).toContainText("Paused");
    await page.getByRole("list", { name: "Workout plans", exact: true }).getByRole("listitem").filter({ hasText: PLAN }).getByRole("button", { name: "Resume" }).click();
    await expect(page.getByRole("list", { name: "Workout plans", exact: true }).getByRole("listitem").filter({ hasText: PLAN })).toContainText("Active");

    // Assigning the same plan again says so, in plain words.
    await page.getByRole("button", { name: "Assign a plan" }).first().click();
    const again = page.getByRole("dialog", { name: `Assign a plan to ${OWN}` });
    await again.getByLabel("Plan", { exact: true }).selectOption({ label: PLAN });
    await again.getByRole("button", { name: "Assign plan" }).click();
    await expect(again.getByText("This member already has this plan.")).toBeVisible();
    await again.getByRole("button", { name: "Close" }).first().click();

    // Create a sign-in link: shown once with the expiry note and a copy button.
    await page.getByRole("button", { name: "Create sign-in link" }).click();
    const field = page.getByRole("textbox", { name: "Sign-in link" });
    await expect(field).toBeVisible();
    const url = await field.inputValue();
    expect(url).toMatch(/\/auth\/magic\?token=/);
    await expect(page.getByText(/expires in 15 minutes/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy link" })).toBeVisible();
    await noHorizontalScroll(page);
    await page.getByRole("button", { name: "Hide link" }).click();
    await expect(page.getByRole("textbox", { name: "Sign-in link" })).toHaveCount(0);

    // Reload keeps the goal and the plan (server state), and does not show the link again.
    await page.goto(detailUrl);
    await expect(page.getByRole("list", { name: "Goals", exact: true }).getByRole("listitem").filter({ hasText: goalTitle })).toContainText("Achieved");
    await expect(page.getByRole("list", { name: "Workout plans", exact: true }).getByRole("listitem").filter({ hasText: PLAN })).toContainText("Active");

    // The link signs in as the member in a fresh context; the customer sees the coach's changes.
    const ctx = await browser.newContext({ viewport: { width: 360, height: 780 } });
    const customer = await ctx.newPage();
    await customer.goto(url);
    await expect(customer).toHaveURL(/\/customer\/home$/);
    await expect(customer.getByRole("region", { name: PLAN })).toBeVisible();
    await customer.goto("/customer/updates");
    await expect(customer.getByText(`New goal: ${goalTitle}`)).toBeVisible();
    await expect(customer.getByText(new RegExp(PLAN)).first()).toBeVisible();
    // The same link cannot be used twice.
    const reuse = await ctx.newPage();
    await ctx.clearCookies();
    await reuse.goto(url);
    await expect(reuse.getByText("This link cannot be used")).toBeVisible();
    await ctx.close();
  });

  test("My record shows delivered sessions and fits 360px", async ({ page }) => {
    await signInAs(page, "demo-gym", "coach");
    await page.goto("/coach");
    await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "My record" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "My record" })).toBeVisible();
    for (const label of ["Sessions scheduled", "Sessions completed", "Consistency", "Member attendance", "Goals achieved", "Level promotions"]) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByRole("img", { name: /last 8 weeks/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recent completed sessions" })).toBeVisible();
    await expect(page.getByText(/\d+ present, \d+ absent, \d+ excused/).first()).toBeVisible();
    await noHorizontalScroll(page);
    await page.getByRole("link", { name: "Last 90 days" }).click();
    await expect(page).toHaveURL(/days=90/);
    await expect(page.getByRole("heading", { level: 1, name: "My record" })).toBeVisible();
  });

  test("a coach cannot open another coach's member", async ({ page }) => {
    const id = await memberId(OTHER);
    await signInAs(page, "demo-gym", "coach");
    await page.goto(`/coach/members/${id}`);
    await expect(page.getByRole("heading", { level: 1, name: "This member is not one of yours" })).toBeVisible();
    await expect(page.getByText("You can open only the members of your own batches.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create sign-in link" })).toHaveCount(0);
    await noHorizontalScroll(page);
    // A made-up id is simply not found.
    await page.goto("/coach/members/does-not-exist-123");
    await expect(page.getByText("This page could not be found")).toBeVisible();
  });

  test("owner opens any member from the members table", async ({ page }) => {
    await signInAs(page, "demo-gym", "owner");
    await page.goto("/owner/members");
    await expect(page.getByRole("heading", { level: 1, name: "Members" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Import members from CSV" })).toBeVisible();
    await page.getByRole("link", { name: `Open ${OTHER}` }).click();
    await expect(page.getByRole("heading", { level: 1, name: OTHER })).toBeVisible();
    await expect(page.getByRole("button", { name: "New goal" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Create sign-in link" })).toBeVisible();
    await noHorizontalScroll(page);
  });

  test("a customer cannot reach the member screens", async ({ page }) => {
    const id = await memberId(OWN);
    await signInAs(page, "demo-gym", "customer");
    for (const path of ["/coach/members", `/coach/members/${id}`, "/coach/record", "/owner/members", `/owner/members/${id}`]) {
      await page.goto(path);
      await expect(page.locator("section[role=alert]"), path).toContainText("not available for your role");
      await expect(page.locator('nav a[href^="/coach"]'), path).toHaveCount(0);
    }
    await page.goto("/customer/members");
    await expect(page.getByText("This page could not be found")).toBeVisible();
  });
});
