import { expect, test, type Page } from "@playwright/test";
import { NAV, ROLES, type Role } from "../lib/nav";

// Names, logos and colours the UI shows per demo tenant today (lib/mock-session.ts).
const TENANTS = [
  { slug: "demo-karate", name: "Demo Karate Academy", logo: "/demo-logos/karate.svg", primary: "#b3261e" },
  { slug: "demo-gym", name: "Demo Iron Gym", logo: "/demo-logos/gym.svg", primary: "#0f766e" },
  { slug: "demo-classes", name: "Demo Group Classes Studio", logo: "/demo-logos/classes.svg", primary: "#6d28d9" },
];

async function rootVar(page: Page, name: string) {
  return page.evaluate((n) => document.documentElement.style.getPropertyValue(n).trim().toLowerCase(), name);
}

async function pick(page: Page, label: "Business" | "View as", value: string) {
  await page.getByRole("combobox", { name: label, exact: true }).selectOption(value);
  // The switcher sets a cookie then router.refresh(); wait for the server render to settle.
  await page.waitForLoadState("networkidle");
}

test.describe("(c) switch tenant in the UI", () => {
  test("name, logo and colours change with the tenant", async ({ page, context }) => {
    await context.clearCookies();
    await page.goto("/");
    const seen = new Set<string>();
    for (const t of TENANTS) {
      await pick(page, "Business", t.slug);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(t.name);
      await expect(page).toHaveTitle(t.name);
      await expect(page.locator("img.logo-img").first()).toHaveAttribute("src", t.logo);
      await expect.poll(() => rootVar(page, "--primary")).toBe(t.primary);
      const bg = await page.locator("a.btn").first().evaluate((el) => getComputedStyle(el).backgroundColor);
      seen.add(bg);
      // Logo must really load, not 404.
      const res = await page.request.get(t.logo);
      expect(res.ok()).toBe(true);
    }
    expect(seen.size, "each tenant paints a different primary colour").toBe(TENANTS.length);
  });

  test("the chosen tenant persists into the app shell and shows no builder branding", async ({ page, context }) => {
    await context.clearCookies();
    await page.goto("/");
    await pick(page, "Business", "demo-gym");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Demo Iron Gym");
    await page.goto("/owner/dashboard");
    await expect(page.locator(".shell-title strong")).toHaveText("Demo Iron Gym");
    expect(await rootVar(page, "--primary")).toBe("#0f766e");
    await expect(page.locator("body")).not.toContainText(/project all star/i);
  });
});

test.describe("(d) each role sees only its own screens", () => {
  for (const role of ROLES) {
    test(`${role}: own screens open, other roles' screens are refused`, async ({ page, context }) => {
      await context.clearCookies();
      await page.goto("/");
      await pick(page, "View as", role);
      await expect(page.getByRole("link", { name: /Continue as/ })).toHaveAttribute("href", `/${role}`);
      await page.goto(`/${role}`);
      const navLinks = page.getByRole("navigation", { name: "Main navigation" }).locator("a");
      await expect(navLinks).toHaveCount(NAV[role].length);
      for (const item of NAV[role]) {
        await page.goto(`/${role}/${item.section}`);
        await expect(page.locator("section[role=alert]")).toHaveCount(0);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      }
      for (const other of ROLES.filter((r) => r !== role)) {
        for (const path of [`/${other}`, ...NAV[other].map((i) => `/${other}/${i.section}`)]) {
          await page.goto(path);
          await expect(page.locator("section[role=alert]"), path).toContainText("not available for your role");
          // Shell stays the user's own: no link into the other role's screens.
          await expect(page.locator(`nav a[href^="/${other}"]`), path).toHaveCount(0);
        }
      }
    });
  }
});

test.describe("(e) real magic-link API: dev link, exchange, /me", () => {
  const USERS: { tenant: string; role: Role; email: string }[] = ["demo-karate", "demo-gym", "demo-studio"].flatMap((tenant) => [
    { tenant, role: "owner" as const, email: `owner@${tenant}.example.test` },
    { tenant, role: "coach" as const, email: `c1@${tenant}.example.test` },
    {
      tenant,
      role: "customer" as const,
      email: tenant === "demo-karate" ? `member-a1@${tenant}.example.test` : `member-m1@${tenant}.example.test`,
    },
  ]);

  for (const u of USERS) {
    test(`${u.tenant} ${u.role}`, async ({ request }) => {
      const link = await request.post("/api/v1/dev/magic-link", { data: { tenantSlug: u.tenant, email: u.email } });
      expect(link.status()).toBe(200);
      const { url } = (await link.json()) as { url: string };
      const token = new URL(url).searchParams.get("token");
      expect(token).toBeTruthy();

      const ex = await request.post("/api/v1/auth/magic-link/exchange", { data: { token } });
      expect(ex.status()).toBe(200);
      const session = (await ex.json()) as { accessToken: string; user: { role: string; tenantSlug: string } };
      expect(session.user).toMatchObject({ role: u.role, tenantSlug: u.tenant });

      const me = await request.get("/api/v1/me", { headers: { authorization: `Bearer ${session.accessToken}` } });
      expect(me.status()).toBe(200);
      expect(await me.json()).toMatchObject({ role: u.role, tenantSlug: u.tenant });

      // Single use.
      const again = await request.post("/api/v1/auth/magic-link/exchange", { data: { token } });
      expect(again.status()).toBeGreaterThanOrEqual(400);
    });
  }

  test("no credentials, or another tenant's email, gets no session", async ({ request }) => {
    expect((await request.get("/api/v1/me")).status()).toBe(401);
    const cross = await request.post("/api/v1/dev/magic-link", {
      data: { tenantSlug: "demo-gym", email: "owner@demo-karate.example.test" },
    });
    expect(cross.status()).toBe(404);
  });
});

test.describe("UI sign-in by magic link (documented gap)", () => {
  // EXPECTED FAILURE: there is no frontend landing page for /auth/magic?token=... yet (Backlog task).
  // test.fail() keeps the suite green now and turns red the day the page ships, which is the cue
  // to delete the .fail() line and make this a normal test.
  test.fail("opening a magic link signs the user into their own role's home", async ({ page, request, context }) => {
    await context.clearCookies();
    const link = await request.post("/api/v1/dev/magic-link", {
      data: { tenantSlug: "demo-karate", email: "c1@demo-karate.example.test" },
    });
    const { url } = (await link.json()) as { url: string };
    const res = await page.goto(url);
    expect(res?.status()).toBeLessThan(400);
    await expect(page).toHaveURL(/\/coach/);
    await expect(page.locator(".shell-title small")).toContainText("Coach");
  });
});
