import { PrismaClient } from "@prisma/client";
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { scratchUrl } from "./db";

// Customer Schedule, Progress and Profile (STAR-70) on the rich demo seed:
// demo-gym m1 is waitlisted #1 on the full session (capacity 4, 4 booked, 2 waitlisted),
// the gym shows the missed-session cost (setting on), the studio does not (setting off).

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

const M1 = { tenant: "demo-gym", email: "member-m1@demo-gym.example.test" };
const A1 = { tenant: "demo-karate", email: "member-a1@demo-karate.example.test" };
const PARENT = { tenant: "demo-karate", email: "parent-g1@demo-karate.example.test" };
const STUDIO = { tenant: "demo-studio", email: "member-m1@demo-studio.example.test" };

async function signIn(page: Page, request: APIRequestContext, u: { tenant: string; email: string }) {
  await page.context().clearCookies();
  const res = await request.post("/api/v1/dev/magic-link", { data: { tenantSlug: u.tenant, email: u.email } });
  expect(res.status()).toBe(200);
  const { url } = (await res.json()) as { url: string };
  await page.goto(url);
  await expect(page).toHaveURL(/\/customer\/home$/, { timeout: 45_000 });
}

const sessions = (page: Page) => page.locator('li[data-testid="session"]');
const fullClass = (page: Page) => sessions(page).filter({ hasText: "Class is full" });

/** Walks forward week by week until a session card matching the locator factory shows up. */
async function findInWeeks(page: Page, pick: () => Locator, weeks = 4): Promise<Locator> {
  await page.goto("/customer/schedule?view=week");
  for (let i = 0; i < weeks; i++) {
    // The page streams behind a loading skeleton: wait for the real heading before looking.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Schedule");
    const hit = pick();
    if ((await hit.count()) > 0) return hit.first();
    // The heading is also on the page we are leaving, so wait for the new week itself: its Next link points further on.
    const next = page.getByRole("link", { name: "Next" });
    const href = await next.getAttribute("href");
    await next.click();
    await expect(page.getByRole("link", { name: "Next" })).not.toHaveAttribute("href", href!);
  }
  throw new Error("no matching session in the next weeks");
}

async function settings(window?: number) {
  const db = new PrismaClient({ datasources: { db: { url: scratchUrl() } } });
  try {
    const tenant = await db.tenant.findFirstOrThrow({ where: { slug: M1.tenant } });
    const row = await db.tenantSettings.findFirstOrThrow({ where: { tenantId: tenant.id } });
    if (window !== undefined) await db.tenantSettings.update({ where: { id: row.id }, data: { bookingCancelWindowMinutes: window } });
    return row.bookingCancelWindowMinutes;
  } finally {
    await db.$disconnect();
  }
}

test("waitlist: position is shown, leaving and joining again goes to the back of the line", async ({ page, request }) => {
  await signIn(page, request, M1);
  await page.goto("/customer/schedule");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Schedule");
  await expect(page.getByText("You can cancel a booking up to 120 minutes before the class starts.")).toBeVisible();

  const full = await findInWeeks(page, () => fullClass(page).filter({ hasText: "Waiting list: position 1" }));
  await expect(full).toContainText("2 on the waiting list");

  // Leave the waiting list (well before the window), with a confirmation.
  await full.getByRole("button", { name: "Leave waiting list" }).click();
  await expect(page.getByRole("dialog")).toContainText("Cancel this booking?");
  await page.getByRole("button", { name: "Yes, cancel" }).click();
  const again = fullClass(page).filter({ has: page.getByRole("button", { name: "Join waiting list" }) }).first();
  await expect(again).toBeVisible();
  await expect(again.getByTestId("booking-note")).toContainText("Booking cancelled.");

  // Join again: full class, so the waiting list, behind the other two (the other one renumbers to 1).
  await again.getByRole("button", { name: "Join waiting list" }).click();
  const joined = fullClass(page).filter({ hasText: "Waiting list: position" }).first();
  await expect(joined).toContainText("Waiting list: position 2", { timeout: 15_000 });
  await expect(joined.getByTestId("booking-note")).toContainText("You are on the waiting list at position 2");
});

test("book a session, see the cancel deadline, then cancel outside the window", async ({ page, request }) => {
  await signIn(page, request, M1);
  const open = await findInWeeks(page, () =>
    sessions(page).filter({ has: page.getByRole("button", { name: "Book", exact: true }) }),
  );
  const id = await open.getAttribute("data-session-id");
  const card = page.locator(`li[data-session-id="${id}"]`);
  await card.getByRole("button", { name: "Book", exact: true }).click();
  await expect(card).toHaveAttribute("data-booking", "booked", { timeout: 15_000 });
  await expect(card.getByTestId("booking-note")).toContainText("Booked. See you there!");
  await expect(card.getByTestId("cancel-info")).toContainText("You can cancel until");

  await page.reload();
  const again = page.locator(`li[data-session-id="${id}"]`);
  if ((await again.count()) === 0) await findInWeeks(page, () => page.locator(`li[data-session-id="${id}"]`));
  const persisted = page.locator(`li[data-session-id="${id}"]`);
  await expect(persisted).toHaveAttribute("data-booking", "booked");

  await persisted.getByRole("button", { name: "Cancel booking" }).click();
  await page.getByRole("button", { name: "Yes, cancel" }).click();
  await expect(persisted).toHaveAttribute("data-booking", "none", { timeout: 15_000 });
  await expect(persisted.getByTestId("booking-note")).toContainText("Booking cancelled.");
  await expect(persisted.getByRole("button", { name: "Book", exact: true })).toBeVisible();
});

test("inside the window cancel is disabled with an explanation, and a stale page gets the friendly 409", async ({ page, request }) => {
  const original = await settings();
  const db = new PrismaClient({ datasources: { db: { url: scratchUrl() } } });
  let restore: { id: string; startsAt: Date; endsAt: Date } | null = null;
  try {
    // A booked session of m1 that starts in 24 hours: outside the 2 hour window, inside a 48 hour one.
    const tenant = await db.tenant.findFirstOrThrow({ where: { slug: M1.tenant } });
    const member = await db.member.findFirstOrThrow({ where: { tenantId: tenant.id, user: { email: M1.email } } });
    const booking = await db.sessionBooking.findFirstOrThrow({
      where: { memberId: member.id, status: "BOOKED", session: { startsAt: { gt: new Date() }, status: "SCHEDULED" } },
      include: { session: true },
      orderBy: { session: { startsAt: "asc" } },
    });
    const s = booking.session;
    restore = { id: s.id, startsAt: s.startsAt, endsAt: s.endsAt };
    const start = new Date(Date.now() + 24 * 3_600_000);
    await db.session.update({ where: { id: s.id }, data: { startsAt: start, endsAt: new Date(start.getTime() + 3_600_000) } });

    await signIn(page, request, M1);
    const card = await findInWeeks(page, () => page.locator(`li[data-session-id="${s.id}"]`));
    await expect(card.getByRole("button", { name: "Cancel booking" })).toBeEnabled();
    await expect(card.getByTestId("cancel-info")).toContainText("You can cancel until");

    // The window grows to 48 hours while the page is open: cancelling returns the 409 with the deadline, in friendly words.
    await settings(2880);
    await card.getByRole("button", { name: "Cancel booking" }).click();
    await page.getByRole("button", { name: "Yes, cancel" }).click();
    await expect(card.getByTestId("booking-note")).toContainText("The cancellation window closed at");
    await expect(card).toHaveAttribute("data-booking", "booked");

    // After the refresh the button is disabled and explains why.
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Schedule");
    const after = page.locator(`li[data-session-id="${s.id}"]`);
    await expect(after.getByRole("button", { name: "Cancel booking" })).toBeDisabled();
    await expect(after.getByTestId("cancel-info")).toContainText("The cancellation window closed at");
  } finally {
    await settings(original);
    if (restore) await db.session.update({ where: { id: restore.id }, data: { startsAt: restore.startsAt, endsAt: restore.endsAt } });
    await db.$disconnect();
  }
});

test("cancelled sessions and holidays get positive notices; attendance history and month view work", async ({ page, request }) => {
  await signIn(page, request, M1);
  await page.goto("/customer/schedule?view=month");
  const grid = page.getByTestId("month-grid");
  await expect(grid).toBeVisible();
  // Pick the first day that has sessions.
  const dayLink = grid.getByRole("link", { name: /: [1-9]\d* sessions$/ }).first();
  await dayLink.click();
  await expect(page.getByRole("heading", { name: /^Sessions on / })).toBeVisible();
  await expect(sessions(page).first()).toBeVisible();

  // Past month: the seeded holiday and a coach-cancelled class are shown without blame.
  await page.goto("/customer/schedule?view=week&from=" + new Date(Date.now() + 330 * 60_000 - 21 * 86_400_000).toISOString().slice(0, 10));
  await expect(page.getByTestId("attendance-history")).toBeVisible();
  const text = (await page.locator("main").innerText()).toLowerCase();
  expect(text).not.toContain("accountab");
  expect(text).not.toContain("surveil");
  if (text.includes("holiday:")) await expect(page.getByText(/Enjoy the rest, classes are back soon/).first()).toBeVisible();
  if (text.includes("not running")) await expect(page.getByText(/Nothing counts against you/).first()).toBeVisible();
});

test("progress shows real goals, attendance, streaks, charts, level and the missed-class view when the setting is on", async ({ page, request }) => {
  await signIn(page, request, M1);
  await page.goto("/customer/progress");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Progress");
  await expect(page.getByTestId("level-name")).toBeVisible();

  const goals = page.getByTestId("goal");
  expect(await goals.count()).toBeGreaterThanOrEqual(3);
  for (const g of await goals.all()) {
    await expect(g.getByTestId("goal-percent")).toHaveText(/^\d+(\.\d)?% of the way$/);
    await expect(g.getByRole("progressbar")).toHaveAttribute("aria-valuenow", /^\d+(\.\d)?$/);
  }
  // A custom goal lists its check-ins.
  const custom = goals.filter({ has: page.locator("details") }).first();
  await expect(custom).toBeVisible();
  await custom.locator("summary").click();
  await expect(custom.locator("details li").first()).toBeVisible();

  await expect(page.getByText("Current streak")).toBeVisible();
  await expect(page.getByText("Longest streak")).toBeVisible();
  await expect(page.getByText("Hours trained")).toBeVisible();
  const counts = await page.getByTestId("attendance-counts").innerText();
  expect(counts).toMatch(/\d+ attended, \d+ missed, \d+ excused/);
  await expect(page.getByRole("img", { name: "Attendance percent by week" })).toBeVisible();
  await expect(page.getByTestId("achievement").first()).toBeVisible();
  await expect(page.getByTestId("missed-cost")).toBeVisible(); // demo-gym has the setting on

  // 90-day period link.
  await page.getByRole("link", { name: "90 days" }).click();
  await expect(page).toHaveURL(/days=90/, { timeout: 30_000 });

  // Studio: setting off, so no missed-class view at all.
  await signIn(page, request, STUDIO);
  await page.goto("/customer/progress");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Progress");
  await expect(page.getByTestId("missed-cost")).toHaveCount(0);
  await expect(page.getByText("What missed classes mean")).toHaveCount(0);
});

test("profile is display only: name, level, join date, fee badge, language and sign out", async ({ page, request }) => {
  await signIn(page, request, M1);
  await page.goto("/customer/profile");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Profile");
  await expect(page.getByTestId("profile-name")).toContainText("Sample Member 01");
  await expect(page.getByTestId("fee-status")).toContainText(/^(Paid|Due|Overdue|Not set)$/);
  await expect(page.getByText("Member since")).toBeVisible();
  await expect(page.locator("main img")).toHaveCount(0); // never photos
  await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(2); // header + profile
  expect((await page.locator("main").innerText()).toLowerCase()).not.toContain("processing");

  await page.getByRole("main").getByLabel("Language").selectOption("hi");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("प्रोफ़ाइल");
  await page.getByRole("main").getByLabel("भाषा").selectOption("en");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Profile");
});

test("a parent sees the child's guardian on Profile and own-family data only", async ({ page, request }) => {
  await signIn(page, request, PARENT);
  await page.goto("/customer/profile");
  await expect(page.getByTestId("guardian-name")).toBeVisible();
  await page.goto("/customer/progress");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Progress");
  await page.goto("/customer/schedule");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Schedule");

  // Other roles cannot reach these screens.
  await page.context().clearCookies();
  await page.context().addCookies([
    { name: "demo_role", value: "coach", url: page.url() },
    { name: "demo_tenant", value: "demo-gym", url: page.url() },
  ]);
  for (const path of ["/customer/schedule", "/customer/progress", "/customer/profile"]) {
    await page.goto(path);
    await expect(page.locator("section[role=alert]"), path).toContainText("not available for your role");
  }
});

test("demo mode: the customer role shows real data in every demo tenant", async ({ page }) => {
  for (const tenant of ["demo-karate", "demo-gym", "demo-studio"]) {
    await page.context().clearCookies();
    await page.context().addCookies([
      { name: "demo_role", value: "customer", url: "http://127.0.0.1:" + (process.env.E2E_PORT ?? 3211) },
      { name: "demo_tenant", value: tenant, url: "http://127.0.0.1:" + (process.env.E2E_PORT ?? 3211) },
    ]);
    await page.goto("/customer/home");
    await expect(page.getByRole("main")).not.toContainText("no member profile");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Hello");
    await page.goto("/customer/progress");
    await expect(page.getByTestId("level-name")).toBeVisible();
    expect(await page.getByTestId("goal").count()).toBeGreaterThan(0);
    await page.goto("/customer/schedule");
    expect(await sessions(page).count()).toBeGreaterThan(0);
  }
});

test("schedule, progress and profile fit a 360px phone with 44px controls and no horizontal scroll", async ({ page, request }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await signIn(page, request, M1);
  for (const path of ["/customer/schedule", "/customer/schedule?view=month", "/customer/progress", "/customer/profile"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(over, path).toBeLessThanOrEqual(0);
  }
  await page.goto("/customer/schedule");
  await expect(sessions(page).first()).toBeVisible();
  const heights = await sessions(page).locator("button:visible").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  expect(heights.length).toBeGreaterThan(0);
  for (const h of heights) expect(h).toBeGreaterThanOrEqual(43.5);

  // A parent's karate customer too (kids' academy copy).
  await signIn(page, request, A1);
  await page.goto("/customer/progress");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
