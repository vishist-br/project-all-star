import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { NAV, ROLES, type Role } from "../lib/nav";
import { TENANTS as SEED_TENANTS } from "../prisma/seed/data";

// Names, logos and colours come from the seed data, which is what the database (and so the UI) holds.
const TENANTS = (["demo-karate", "demo-gym", "demo-studio"] as const).map((slug) => {
  const t = SEED_TENANTS.find((x) => x.slug === slug)!;
  return { slug, name: t.name, logo: t.theme.logoUrl, primary: t.theme.primaryColor.toLowerCase() };
});

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
    await page.waitForLoadState("networkidle");
    const seen = new Set<string>();
    const options = await page.getByRole("combobox", { name: "Business", exact: true }).locator("option").allTextContents();
    expect(options).toEqual(TENANTS.map((t) => t.name));
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
    await expect(page.getByRole("heading", { level: 1 })).toContainText(TENANTS[1].name);
    await page.goto("/owner/dashboard");
    await expect(page.locator(".shell-title strong")).toHaveText(TENANTS[1].name);
    expect(await rootVar(page, "--primary")).toBe(TENANTS[1].primary);
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

const ROLE_LABEL: Record<Role, string> = { owner: "Owner", coach: "Coach", customer: "Member / Parent" };
const EMAIL: Record<Role, (tenant: string) => string> = {
  owner: (t) => `owner@${t}.example.test`,
  coach: (t) => `c1@${t}.example.test`,
  customer: (t) => (t === "demo-karate" ? `member-a1@${t}.example.test` : `member-m1@${t}.example.test`),
};

async function devLink(request: APIRequestContext, tenantSlug: string, email: string) {
  const res = await request.post("/api/v1/dev/magic-link", { data: { tenantSlug, email } });
  expect(res.status()).toBe(200);
  return ((await res.json()) as { url: string }).url;
}

async function noHorizontalScroll(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over).toBeLessThanOrEqual(0);
}

test.describe("UI sign-in by magic link", () => {
  for (const tenant of ["demo-karate", "demo-gym", "demo-studio"]) {
    for (const role of ROLES) {
      test(`${tenant} ${role}: the link opens the right role home with the tenant's own branding`, async ({ page, request, context }) => {
        await context.clearCookies();
        const seed = TENANTS.find((x) => x.slug === tenant)!;
        const url = await devLink(request, tenant, EMAIL[role](tenant));
        const token = new URL(url).searchParams.get("token")!;
        await page.goto(url);
        await expect(page).toHaveURL(new RegExp(`/${role}$`));
        // The one-time token is gone from the address bar and never stored in the page.
        expect(page.url()).not.toContain(token);
        expect(await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }]))).not.toContain(token);
        await expect(page.locator(".shell-title small")).toContainText(ROLE_LABEL[role]);
        await expect(page.locator(".shell-title strong")).toHaveText(seed.name);
        await expect.poll(() => rootVar(page, "--primary")).toBe(seed.primary);
        await expect(page.locator("img.logo-img").first()).toHaveAttribute("src", seed.logo);
        // Real session: the demo picker is gone and sign-out is offered.
        await expect(page.getByRole("combobox", { name: "Business", exact: true })).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
        // Cookies: httpOnly, SameSite=Lax; invisible to page scripts.
        const cookies = await context.cookies();
        for (const name of ["as_access", "as_refresh"]) {
          const c = cookies.find((x) => x.name === name);
          expect(c, name).toBeTruthy();
          expect(c).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });
        }
        expect(await page.evaluate(() => document.cookie)).not.toContain("as_");
        // Another role's screens stay refused.
        const other = ROLES.find((r) => r !== role)!;
        await page.goto(`/${other}`);
        await expect(page.locator("section[role=alert]")).toContainText("not available for your role");
      });
    }
  }

  test("a used, bogus or incomplete link shows a friendly message and signs nobody in", async ({ page, request, context }) => {
    await context.clearCookies();
    const url = await devLink(request, "demo-karate", EMAIL.coach("demo-karate"));
    await page.goto(url);
    await expect(page).toHaveURL(/\/coach$/);
    await context.clearCookies();
    await page.goto(url); // already used
    await expect(page.locator("main section[role=alert]")).toContainText("cannot be used");
    await expect(page.locator("main section[role=alert]")).toContainText("expired");
    expect(page.url()).not.toContain("token=");
    expect((await context.cookies()).some((c) => c.name === "as_access")).toBe(false);
    await page.goto("/auth/magic?token=not-a-real-token");
    await expect(page.locator("main section[role=alert]")).toContainText("cannot be used");
    await page.goto("/auth/magic");
    await expect(page.locator("main section[role=alert]")).toContainText("incomplete");
  });

  test("the access token is refreshed from the refresh cookie", async ({ page, request, context }) => {
    await context.clearCookies();
    await page.goto(await devLink(request, "demo-gym", EMAIL.owner("demo-gym")));
    await expect(page).toHaveURL(/\/owner$/);
    const before = (await context.cookies()).find((c) => c.name === "as_access")!.value;
    // Simulate expiry: the access cookie disappears, the refresh cookie remains.
    await context.clearCookies({ name: "as_access" });
    await page.goto("/owner/dashboard");
    await expect(page.locator("section[role=alert]")).toHaveCount(0);
    await expect(page.locator(".shell-title small")).toContainText("Owner");
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    const after = (await context.cookies()).find((c) => c.name === "as_access");
    expect(after?.value).toBeTruthy();
    expect(after?.value).not.toBe(before);
  });

  test("sign out ends the session and clears the cookies", async ({ page, request, context }) => {
    await context.clearCookies();
    await page.goto(await devLink(request, "demo-karate", EMAIL.customer("demo-karate")));
    await expect(page).toHaveURL(/\/customer$/);
    const access = (await context.cookies()).find((c) => c.name === "as_access")!.value;
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Please sign in");
    const names = (await context.cookies()).map((c) => c.name);
    expect(names).not.toContain("as_access");
    expect(names).not.toContain("as_refresh");
    // The server-side session is revoked too.
    expect((await request.get("/api/v1/me", { headers: { authorization: `Bearer ${access}` } })).status()).toBe(401);
  });

  test("pages fit a 360px phone without horizontal scroll", async ({ page, request, context }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await context.clearCookies();
    await page.goto("/sign-in");
    await noHorizontalScroll(page);
    await page.goto("/auth/magic?token=nope");
    await expect(page.locator("main section[role=alert]")).toBeVisible();
    await noHorizontalScroll(page);
    await page.goto(await devLink(request, "demo-studio", EMAIL.owner("demo-studio")));
    await expect(page).toHaveURL(/\/owner$/);
    await noHorizontalScroll(page);
    await page.goto("/owner/members");
    await noHorizontalScroll(page);
  });
});

test.describe("owner screens show the tenant's own data", () => {
  test("members, batches, coaches, dashboard and settings are filled from the database", async ({ page, context }) => {
    await context.clearCookies();
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await pick(page, "Business", "demo-karate");
    await page.goto("/owner/members");
    await expect(page.locator("tbody tr").first()).toBeVisible();
    expect(await page.locator("tbody tr").count()).toBeGreaterThan(3);
    await expect(page.getByText("Sample Kid 01")).toBeVisible();
    await page.goto("/owner/batches");
    expect(await page.locator("ul.card-list li").count()).toBeGreaterThan(0);
    await page.goto("/owner/coaches");
    await expect(page.getByText("Sample Coach Alpha")).toBeVisible();
    await page.goto("/owner/dashboard");
    await expect(page.getByText("Active members")).toBeVisible();
    await page.goto("/owner/settings");
    await expect(page.locator("ul.card-list li").filter({ hasText: SEED_TENANTS.find((x) => x.slug === "demo-karate")!.name })).toBeVisible();
    // Another tenant's people never appear.
    await pick(page, "Business", "demo-gym");
    await page.goto("/owner/members");
    await expect(page.getByText("Sample Kid 01")).toHaveCount(0);
  });
});

test.describe("live member import through the session cookie", () => {
  test("a signed-in owner can check a CSV; without a session it is refused", async ({ page, request }) => {
    const csv = Buffer.from("name,phone,email,guardian_name,guardian_phone,batch_name,sport,level,goal,join_date,fee_status\n");
    const body = { multipart: { file: { name: "m.csv", mimeType: "text/csv", buffer: csv } } };
    const anon = await request.post("/ui/members-import?dryRun=true", body);
    expect(anon.status()).toBe(401);
    await page.goto(await devLink(request, "demo-karate", EMAIL.owner("demo-karate")));
    await expect(page).toHaveURL(/\/owner$/);
    const res = await page.request.post("/ui/members-import?dryRun=true", body);
    expect(res.status()).not.toBe(401);
    expect(res.status()).not.toBe(403);
  });
});
