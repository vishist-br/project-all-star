import { expect as baseExpect, test, type Page } from "@playwright/test";

// Routes compile on first visit in `next dev`, so give assertions more room than the 5s default.
const expect = baseExpect.configure({ timeout: 20_000 });

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

const istToday = (plusDays = 0) => new Date(Date.now() + 330 * 60_000 + plusDays * 86_400_000).toISOString().slice(0, 10);

/** Fills the schedule form for the coach's first batch. */
async function fillSchedule(page: Page, opts: { date: string; start: string; end: string }) {
  await page.goto("/coach/sessions/new");
  await expect(page.getByRole("heading", { level: 1, name: "Schedule a session" })).toBeVisible();
  await page.getByLabel("Batch", { exact: true }).selectOption({ index: 1 });
  await page.getByLabel("Date").fill(opts.date);
  await page.getByLabel("Starts").fill(opts.start);
  await page.getByLabel("Ends").fill(opts.end);
  await page.getByRole("button", { name: "Schedule session" }).click();
}

const rows = (page: Page) => page.getByRole("list", { name: "Members" }).getByRole("listitem");
const rowMain = (page: Page, i: number) => rows(page).nth(i).locator("button[data-status]");

test.describe("coach sessions", () => {
  test.use({ viewport: { width: 360, height: 780 } });
  test.setTimeout(180_000);

  test("today, schedule, one-tap roll call, offline queue, complete, availability", async ({ page, context }) => {
    await signInAs(page, "demo-gym", "coach");

    // Today, inside the coach nav. On a phone the bottom bar shows the four main screens plus More;
    // the other screens are reached from the More page, which lists every coach screen.
    await page.goto("/coach");
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav.getByRole("link")).toHaveCount(4 + 1);
    await page.goto("/coach/more");
    await expect(page.getByRole("heading", { level: 1, name: "More" })).toBeVisible();
    await expect(page.locator("ul.more-list a")).toHaveCount(7);
    await page.goto("/coach");
    // (The Next dev indicator covers the left-most nav item at 360px, so follow its href instead of clicking.)
    const todayHref = await nav.getByRole("link", { name: "Today" }).getAttribute("href");
    expect(todayHref).toBe("/coach/today");
    await page.goto(todayHref!);
    await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Schedule views" }).getByRole("link")).toHaveCount(3);
    await noHorizontalScroll(page);

    // Schedule a session for today 00:05 (always already started, so it can be completed).
    await page.getByRole("link", { name: "Schedule a session" }).first().click();
    await fillSchedule(page, { date: istToday(), start: "00:05", end: "00:35" });
    await expect(page.getByRole("heading", { name: "Session scheduled" })).toBeVisible();
    // The coach has weekly availability and 00:05 is outside it: friendly warning, session still created.
    await expect(page.getByText(/outside your weekly availability/)).toBeVisible();
    await noHorizontalScroll(page);
    await page.getByRole("link", { name: "Open session" }).click();
    await expect(page).toHaveURL(/\/coach\/sessions\/(?!new)[^/]+$/);
    const sessionUrl = page.url();

    // An overlapping session is refused (409) in friendly words.
    await fillSchedule(page, { date: istToday(), start: "00:20", end: "00:50" });
    await expect(page.getByRole("alert").filter({ hasText: "overlaps another scheduled session" })).toBeVisible();

    // Roll call: one tap per member.
    await page.goto(sessionUrl);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(rows(page).first()).toBeVisible();
    const count = await rows(page).count();
    expect(count).toBeGreaterThanOrEqual(3);
    await noHorizontalScroll(page);
    await rowMain(page, 0).click();
    await expect(rowMain(page, 0)).toHaveAttribute("data-status", "present");
    await rowMain(page, 1).click();
    await rowMain(page, 1).click(); // present, then absent
    await expect(rowMain(page, 1)).toHaveAttribute("data-status", "absent");
    await expect(page.getByTestId("sync-status")).toContainText("All changes saved");

    // Excused needs a reason.
    await rows(page).nth(2).getByRole("button", { name: /More options/ }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("button", { name: "Excused" }).click();
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(sheet.getByText("Choose a reason for the excused absence.")).toBeVisible();
    await sheet.getByLabel("Reason for excused absence").selectOption("illness");
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(rowMain(page, 2)).toHaveAttribute("data-status", "excused");
    await expect(rows(page).nth(2)).toContainText("Illness");
    await expect(page.getByTestId("sync-status")).toContainText("All changes saved");

    // Go offline: taps are kept on the device and shown as waiting.
    await context.setOffline(true);
    await expect(page.getByText("You are offline").first()).toBeVisible();
    const lastIndex = count - 1;
    await rowMain(page, lastIndex).click();
    await expect(rowMain(page, lastIndex)).toHaveAttribute("data-status", "present");
    await expect(rows(page).nth(lastIndex)).toContainText("Waiting to sync");
    if (count > 4) {
      await rowMain(page, 3).click();
      await expect(rows(page).nth(3)).toContainText("Waiting to sync");
    }
    await expect(page.getByTestId("sync-status")).toContainText("saved on this device");
    // A group class is finished with "Finish class and send", which (unlike a one-on-one's Complete) can be queued offline.
    await expect(page.getByRole("button", { name: "Finish class and send" })).toBeEnabled();
    const stored = await page.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith("rollcall.queue")).map(([, v]) => JSON.parse(v)));
    expect(stored.length).toBe(1);
    expect(stored[0].length).toBe(count > 4 ? 2 : 1);
    expect(stored[0][0].clientId.length).toBeGreaterThanOrEqual(8);

    // Back online: the queue replays and shows as saved; nothing is left in storage.
    await context.setOffline(false);
    await expect(page.getByTestId("sync-status")).toContainText("All changes saved", { timeout: 20_000 });
    await expect(rows(page).nth(lastIndex)).not.toContainText("Waiting to sync");
    await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("rollcall.queue")).length)).toBe(0);

    // Reload: attendance is persisted on the server.
    await page.reload();
    await expect(rowMain(page, 0)).toHaveAttribute("data-status", "present");
    await expect(rowMain(page, 1)).toHaveAttribute("data-status", "absent");
    await expect(rowMain(page, 2)).toHaveAttribute("data-status", "excused");
    await expect(rowMain(page, lastIndex)).toHaveAttribute("data-status", "present");

    // Complete with a note.
    await page.getByLabel("Session note (optional)").fill("Good energy today");
    await page.getByRole("button", { name: "Finish class and send" }).click();
    const finishSheet = page.getByRole("dialog", { name: "Finish class and send" });
    await expect(finishSheet.getByLabel("Note to the class (optional)")).toHaveValue("Good energy today");
    await finishSheet.getByRole("button", { name: "Finish and send" }).click();
    await expect(page.getByText("Class finished", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("Completed", { exact: true }).first()).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Session note (optional)")).toHaveValue("Good energy today");
    await expect(rowMain(page, 1)).toHaveAttribute("data-status", "absent");
    await expect(page.getByRole("button", { name: "Finish class and send" })).toHaveCount(0);

    // Today and Week list it.
    await page.goto("/coach/today");
    await expect(page.getByText("Completed", { exact: true }).first()).toBeVisible();
    await page.getByRole("link", { name: "Week", exact: true }).click();
    await expect(page).toHaveURL(/\/coach\/today\/week/, { timeout: 30_000 }); // first compile of the route in dev
    await expect(page.getByRole("list", { name: "Days of the week" })).toBeVisible({ timeout: 20_000 });
    await noHorizontalScroll(page);
    await page.getByRole("link", { name: "Next week" }).click();
    await expect(page.getByRole("list", { name: "Days of the week" })).toBeVisible({ timeout: 20_000 });

    // Cancel and reschedule need a confirm step.
    await fillSchedule(page, { date: istToday(2), start: "00:05", end: "00:35" });
    await expect(page.getByRole("heading", { name: "Session scheduled" })).toBeVisible();
    await page.getByRole("link", { name: "Open session" }).click();
    await page.getByRole("button", { name: "Reschedule" }).click();
    const resched = page.getByRole("dialog", { name: "Reschedule session" });
    await resched.getByLabel("Date").fill(istToday(3));
    await resched.getByRole("button", { name: "Move session" }).click();
    await expect(page.getByText(/Session moved/)).toBeVisible();
    // 00:05 is outside the weekly availability: the warning stays in the sheet until it is closed.
    await expect(resched.getByText(/outside your weekly availability/)).toBeVisible();
    await resched.getByRole("button", { name: "Close", exact: true }).last().click();
    await page.getByRole("button", { name: "Cancel session" }).click();
    const cancel = page.getByRole("dialog", { name: "Cancel this session?" });
    await cancel.getByRole("button", { name: "Keep as is" }).click();
    await expect(page.getByRole("button", { name: "Cancel session" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel session" }).click();
    await page.getByRole("dialog", { name: "Cancel this session?" }).getByLabel("Reason (optional)").fill("Venue closed");
    await page.getByRole("dialog", { name: "Cancel this session?" }).getByRole("button", { name: "Cancel session" }).click();
    await expect(page.getByText("This session was cancelled.")).toBeVisible();

    // Availability: validation, save, persist.
    await page.goto("/coach/today/availability");
    await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
    await noHorizontalScroll(page);
    await page.getByRole("button", { name: "Add hours on Sunday" }).click();
    await page.getByRole("button", { name: "Add hours on Sunday" }).click();
    const from = page.getByLabel("From");
    const until = page.getByLabel("Until");
    // Two default 09:00-10:00 ranges on Sunday overlap.
    await page.getByRole("button", { name: "Save availability" }).click();
    await expect(page.getByText("Overlaps another time range on Sunday.")).toBeVisible();
    await from.last().fill("11:00");
    await until.last().fill("10:30");
    await expect(page.getByText("The end time must be after the start time.")).toBeVisible();
    await until.last().fill("12:00");
    await page.getByRole("button", { name: "Save availability" }).click();
    await expect(page.getByText("Availability saved")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("From").last()).toHaveValue("11:00");
    await expect(page.getByLabel("Until").last()).toHaveValue("12:00");

    // The session screens are the coach's own: a customer never reaches them.
    await signInAs(page, "demo-gym", "customer");
    for (const path of ["/coach/today", "/coach/today/week", "/coach/today/availability", "/coach/sessions/new", sessionUrl.replace(/^https?:\/\/[^/]+/, "")]) {
      await page.goto(path);
      await expect(page.locator("section[role=alert]"), path).toContainText("not available for your role");
    }
  });
});
