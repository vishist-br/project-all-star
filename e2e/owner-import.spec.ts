import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

// Owner CSV import in demo mode: the screen uses the real endpoint (through the viewer principal).
// Run with its own database and port:
//   E2E_DB_NAME=allstar_e2e_frontend64 E2E_PORT=3264 npx playwright test e2e/owner-import.spec.ts
const fixture = (name: string) => join(__dirname, "..", "tests", "fixtures", name);

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

const input = (page: Page) => page.getByTestId("file-input");
const csv = (name: string, body: string) => ({ name, mimeType: "text/csv", buffer: Buffer.from(body) });

test.describe("owner CSV import", () => {
  test("imports a valid file, shows the result, lists the members, and a repeat is safe", async ({ page }) => {
    test.slow();
    await signIn(page, "demo-gym", "owner", "/owner/members/import");
    await expect(page.getByRole("heading", { level: 1, name: "Import members from CSV" })).toBeVisible();
    await expect(page.getByTestId("demo-note")).toContainText("demo business");
    await expect(page.getByRole("list", { name: "Import steps" }).getByRole("listitem")).toHaveCount(4);
    await expect(page.getByRole("link", { name: "Download CSV template" })).toHaveAttribute("href", "/sample-members.csv");

    await input(page).setInputFiles(fixture("valid.csv"));
    const review = page.getByTestId("review");
    await expect(review.getByRole("heading", { name: "Review before importing" })).toBeVisible();
    await expect(review).toContainText("4 new members are ready to import.");
    await expect(page.getByTestId("preview")).toContainText("Fixture Adult One");
    await expect(page.getByTestId("errors")).toHaveCount(0);

    // Nothing is saved until the owner confirms.
    await page.getByTestId("confirm-import").click();
    await expect(page.getByRole("dialog", { name: "Ready to import?" })).toContainText("demo business");
    await page.getByRole("button", { name: "Yes, import" }).click();
    const done = page.getByTestId("done");
    await expect(done.getByRole("heading", { name: "Import complete" })).toBeVisible();
    await expect(done).toContainText("4 members added to your business.");

    await done.getByRole("link", { name: "View members" }).click();
    await expect(page).toHaveURL(/\/owner\/members$/);
    await expect(page.getByText("Fixture Adult One")).toBeVisible();
    await page.reload();
    await expect(page.getByText("Fixture Kid Two")).toBeVisible();

    // Same file again: everything is skipped, nothing is added, and there is nothing to confirm.
    await page.goto("/owner/members/import");
    await input(page).setInputFiles(fixture("valid.csv"));
    await expect(page.getByTestId("skipped-note")).toContainText("4 rows match members you already have");
    await expect(page.getByTestId("review")).toContainText("already in your member list");
    await expect(page.getByTestId("confirm-import")).toHaveCount(0);
  });

  test("shows row errors in a table and does not offer the import", async ({ page }) => {
    await signIn(page, "demo-karate", "owner", "/owner/members/import");
    await input(page).setInputFiles(fixture("malformed.csv"));
    const errors = page.getByTestId("errors");
    await expect(errors.getByRole("heading", { name: "Rows to fix" })).toBeVisible();
    await expect(errors).toContainText("nothing has been added yet");
    const table = errors.getByRole("table");
    await expect(table.getByRole("columnheader", { name: "Row" })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "Column" })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "What to fix" })).toBeVisible();
    await expect(table.locator("tbody tr").first()).toContainText("name");
    expect(await table.locator("tbody tr").count()).toBeGreaterThanOrEqual(5);
    await expect(page.getByTestId("confirm-import")).toHaveCount(0);
    // Choosing another file works from here.
    await input(page).setInputFiles(fixture("valid.csv"));
    await expect(page.getByTestId("errors")).toHaveCount(0);
    await expect(page.getByTestId("confirm-import")).toBeVisible();
  });

  test("shows warnings in friendly words and still allows the import", async ({ page }) => {
    await signIn(page, "demo-karate", "owner", "/owner/members/import");
    await input(page).setInputFiles(csv("warn.csv", "name,phone,nickname,sport,batch_name\nE2E Warning Person,+919000002001,Nick,Underwater Basketweaving,Nowhere batch\n"));
    const warnings = page.getByTestId("warnings");
    await expect(warnings.getByRole("heading", { name: "Good to know" })).toBeVisible();
    await expect(warnings).toContainText('The column "nickname" is not in the template');
    await expect(warnings).toContainText("sport is not linked");
    await expect(warnings).toContainText("added without a batch");
    await expect(page.getByTestId("confirm-import")).toBeEnabled();
    expect(await page.getByTestId("review").innerText()).not.toMatch(/NaN|undefined|accountab|surveil/i);
  });

  test("explains wrong file type and a file that is too large", async ({ page }) => {
    await signIn(page, "demo-gym", "owner", "/owner/members/import");
    await input(page).setInputFiles({ name: "members.xlsx", mimeType: "application/vnd.ms-excel", buffer: Buffer.from("PK") });
    await expect(page.getByTestId("import-failure")).toContainText("not a CSV file");
    await input(page).setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
    await expect(page.getByTestId("import-failure")).toContainText("not a CSV file");
    await input(page).setInputFiles(csv("big.csv", `name\n${"A".repeat(2 * 1024 * 1024 + 10)}`));
    await expect(page.getByTestId("import-failure")).toContainText("larger than 2 MB");
    // A CSV without a name column is explained by the server.
    await input(page).setInputFiles(fixture("missing-name-column.csv"));
    await expect(page.getByTestId("import-failure")).toContainText("could not read this file");
  });

  test("shows a network problem with a retry", async ({ page }) => {
    await signIn(page, "demo-gym", "owner", "/owner/members/import");
    await page.route("**/ui/members-import*", (route) => route.abort());
    await input(page).setInputFiles(fixture("valid.csv"));
    await expect(page.getByTestId("import-failure")).toContainText("could not reach the server");
    await page.unroute("**/ui/members-import*");
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByTestId("review")).toBeVisible();
  });

  test("coach and customer cannot open or use the import", async ({ page }) => {
    for (const role of ["coach", "customer"] as const) {
      await signIn(page, "demo-gym", role, "/owner/members/import");
      await expect(page.getByRole("heading", { level: 1, name: "This screen is not available for your role" })).toBeVisible();
      await expect(page.getByTestId("file-input")).toHaveCount(0);
      await page.goto(`/${role}/members/import`);
      await expect(page.getByTestId("file-input")).toHaveCount(0);
      const res = await page.request.post("/ui/members-import?dryRun=true", { multipart: { file: { name: "m.csv", mimeType: "text/csv", buffer: Buffer.from("name\nA") } } });
      expect(res.status()).toBe(403);
    }
  });

  test("works at 360px without sideways scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await signIn(page, "demo-gym", "owner", "/owner/members/import");
    await noHorizontalScroll(page);
    await input(page).setInputFiles(fixture("malformed.csv"));
    await expect(page.getByTestId("errors")).toBeVisible();
    await noHorizontalScroll(page);
    await input(page).setInputFiles(csv("wide.csv", "name,phone,email,guardian_name,guardian_phone,batch_name,sport,level,goal,join_date,fee_status\nWide Preview Person,+919000003001,wide@example.invalid,,,Nowhere,Nothing,Lvl,A very long goal text for the preview table to be wide,2026-01-01,paid\n"));
    await expect(page.getByTestId("preview")).toBeVisible();
    await expect(page.getByTestId("warnings")).toBeVisible();
    await noHorizontalScroll(page);
    await page.getByTestId("confirm-import").click();
    await page.getByRole("button", { name: "Yes, import" }).click();
    await expect(page.getByTestId("done")).toBeVisible();
    await noHorizontalScroll(page);
  });
});
