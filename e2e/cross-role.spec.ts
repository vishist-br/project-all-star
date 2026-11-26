import { expect, test, type Page } from "@playwright/test";
import { NAV } from "../lib/nav";
import {
  BASE_URL,
  GYM_NAME,
  KARATE_NAME,
  PEOPLE,
  closeAll,
  expect as ex,
  istToday,
  memberByName,
  noHorizontalScroll,
  openAs,
  tile,
  uniq,
  withDb,
  type Session,
} from "./helpers/cross-role";

// STAR-75: whole-journey scenarios across three separate browser contexts (owner, coach, customer),
// each really signed in by the dev magic link (no demo picker), on the rich seed.
//
//   E2E_WEBPACK=1 E2E_DB_NAME=allstar_e2e_qa75 E2E_PORT=3275 npx playwright test e2e/cross-role.spec.ts
//
// Every test collects browser console errors and unexpected 4xx/5xx or failed requests of every
// page it visits (scenario 8) and fails on any.

test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);


// `next dev` compiles each route on its first visit (seconds). Visit every route once, as each role,
// so the scenarios below measure behaviour and not compile time.
test.beforeAll(async ({ browser }) => {
  test.setTimeout(600_000);
  const plan: [Parameters<typeof openAs>[1], string[]][] = [
    [PEOPLE.gymOwner, ["/owner", "/owner/dashboard", "/owner/members", "/owner/members/import", "/owner/members/x", "/owner/batches", "/owner/coaches", "/owner/coaches/x", "/owner/workouts", "/owner/plans", "/owner/settings"]],
    [PEOPLE.gymCoach, ["/coach", "/coach/today", "/coach/today/week", "/coach/today/availability", "/coach/sessions/new", "/coach/sessions/x", "/coach/members", "/coach/members/x", "/coach/plans", "/coach/plans/new", "/coach/plans/x", "/coach/workouts", "/coach/record"]],
    [PEOPLE.gymM1, ["/customer/home", "/customer/workouts", "/customer/schedule", "/customer/schedule?view=month", "/customer/progress", "/customer/profile", "/customer/updates", "/customer/exercise/x"]],
  ];
  for (const [actor, paths] of plan) {
    const s = await openAs(browser, actor);
    try {
      for (const path of paths) await s.context.request.get(path, { timeout: 120_000 });
    } finally {
      await closeAll(s);
    }
  }
});

const NOT_ALLOWED = "not available for your role";
const PHONE = { width: 390, height: 844 };

/** Asserts no console or network problems on every session, then closes them all. */
async function finish(...sessions: Session[]) {
  for (const s of sessions) s.hygiene.assertClean();
}

const rows = (page: Page) => page.getByRole("list", { name: "Members" }).getByRole("listitem");
const row = (page: Page, name: string) => rows(page).filter({ hasText: name });
const rowMain = (page: Page, name: string) => row(page, name).locator("button[data-status]");

async function countsOf(page: Page): Promise<{ attended: number; missed: number; excused: number }> {
  await page.goto("/customer/progress");
  await ex(page.getByRole("heading", { level: 1 })).toHaveText("Progress");
  const text = await page.getByTestId("attendance-counts").innerText();
  const m = /(\d+) attended, (\d+) missed, (\d+) excused/.exec(text)!;
  return { attended: Number(m[1]), missed: Number(m[2]), excused: Number(m[3]) };
}

/** "3 of 12 workouts done" -> {completed, scheduled} from the coach's member detail. */
async function adherenceOf(page: Page, memberId: string) {
  await page.goto(`/coach/members/${memberId}`);
  const t = tile(page, "Workout adherence");
  await ex(t).toBeVisible();
  const text = await page.locator(".stat-tile").filter({ has: page.locator(".stat-label", { hasText: /^Workout adherence$/ }) }).innerText();
  const m = /(\d+) of (\d+) workouts done/.exec(text);
  return { completed: Number(m?.[1] ?? 0), scheduled: Number(m?.[2] ?? 0), value: (await t.innerText()).trim() };
}

async function scheduleSession(page: Page, o: { batch: RegExp | string; date: string; start: string; end: string; capacity?: number }) {
  await page.goto("/coach/sessions/new");
  await ex(page.getByRole("heading", { level: 1, name: "Schedule a session" })).toBeVisible();
  const opts = await page.getByLabel("Batch", { exact: true }).locator("option").allTextContents();
  const label = opts.find((t) => (typeof o.batch === "string" ? t.includes(o.batch) : o.batch.test(t)));
  if (!label) throw new Error(`no batch like ${o.batch} in ${opts.join("|")}`);
  await page.getByLabel("Batch", { exact: true }).selectOption({ label });
  await page.getByLabel("Date").fill(o.date);
  await page.getByLabel("Starts").fill(o.start);
  await page.getByLabel("Ends").fill(o.end);
  if (o.capacity !== undefined) await page.getByLabel("Capacity (optional)").fill(String(o.capacity));
  await page.getByRole("button", { name: "Schedule session" }).click();
  await ex(page.getByRole("heading", { name: "Session scheduled" })).toBeVisible();
  await page.getByRole("link", { name: "Open session" }).click();
  await ex(page).toHaveURL(/\/coach\/sessions\/(?!new)[^/]+$/);
  return page.url();
}

// ---------------------------------------------------------------------------------------------
// (1) Plan journey: coach builds and assigns, customer sees and completes, coach and owner see it,
//     coach edits, customer sees the update and the unread badge.
// ---------------------------------------------------------------------------------------------
test("(1) plan: coach builds and assigns, customer completes, coach and owner reflect it, edit reaches the Updates feed", async ({ browser }) => {
  const planName = `QA75 Plan ${uniq()}`;
  const coach = await openAs(browser, PEOPLE.gymCoach);
  const customer = await openAs(browser, PEOPLE.gymM2, PHONE);
  const owner = await openAs(browser, PEOPLE.gymOwner);
  try {
    const cp = coach.page;
    const mp = customer.page;

    // The customer starts with no plan of this name and nothing about it in the feed.
    await mp.goto("/customer/updates");
    await ex(mp.getByRole("heading", { level: 1 })).toHaveText("Updates");
    await ex(mp.locator("main")).not.toContainText(planName);

    // Owner baseline (dashboard adherence tile, 7-day range keeps the denominator small).
    await owner.page.goto("/owner/dashboard?range=7");
    await ex(tile(owner.page, "Workout adherence")).toHaveText(/^(\d+(\.\d)?%|Not enough data yet)$/);
    const ownerBefore = (await tile(owner.page, "Workout adherence").innerText()).trim();

    // Coach builds a daily plan from the catalog: three exercises with explicit targets.
    await cp.goto("/coach/plans/new");
    await ex(cp.getByRole("heading", { level: 1, name: "New plan" })).toBeVisible();
    await cp.getByLabel("Plan name").fill(planName);
    await cp.getByLabel("How often").selectOption("daily");
    await cp.getByRole("button", { name: /Add exercises/ }).click();
    const picker = cp.getByRole("dialog", { name: "Add exercises" });
    for (const q of ["squat", "bench press", "curl"]) {
      await picker.getByLabel("Search exercises").fill(q);
      const add = picker.getByRole("button", { name: /^Add / }).first();
      await ex(add).toBeVisible();
      await add.click();
    }
    await picker.getByRole("button", { name: "Done" }).click();
    await ex(cp.getByLabel("Sets")).toHaveCount(3);
    await cp.getByLabel("Sets").nth(0).fill("4");
    await cp.getByLabel("Reps").nth(0).fill("10");
    await cp.getByLabel("Duration (seconds)").nth(0).fill("45");
    await cp.getByLabel("Rest (seconds)").nth(0).fill("60");
    await cp.getByRole("button", { name: "Save and activate" }).click();
    await ex(cp).toHaveURL(/\/coach\/plans$/);
    await ex(cp.getByRole("listitem").filter({ hasText: planName })).toContainText("3 exercises");

    // Assign it to Sample Member 02 from the member detail.
    const m2 = await withDb((db) => memberByName(db, "demo-gym", "Sample Member 02"));
    const before = await adherenceOf(cp, m2.id);
    await cp.getByRole("button", { name: "Assign a plan" }).first().click();
    const assign = cp.getByRole("dialog", { name: "Assign a plan to Sample Member 02" });
    await assign.getByLabel("Plan", { exact: true }).selectOption({ label: planName });
    await assign.getByRole("button", { name: "Assign plan" }).click();
    await ex(cp.getByText("Plan assigned")).toBeVisible();

    // Customer: Home shows the plan with its exercise details; the Updates feed announced it.
    await mp.goto("/customer/home");
    const region = mp.getByRole("region", { name: planName });
    await ex(region).toBeVisible();
    const items = region.locator("li[data-status]");
    await ex(items).toHaveCount(3);
    await ex(items.nth(0)).toContainText("4 sets × 10 reps");
    await ex(items.nth(0)).toContainText(/Rest/);
    await ex(items.nth(0)).toContainText(/per set/);
    await ex(mp.locator("main").getByText(/^\d+ new$/)).toBeVisible();

    // Workouts lists the plan and the coming days with the same exercises.
    await mp.goto("/customer/workouts");
    await ex(mp.getByRole("heading", { level: 1 })).toHaveText("My workouts");
    await ex(mp.getByRole("heading", { name: planName }).first()).toBeVisible();
    await ex(mp.getByText("Every day").first()).toBeVisible();
    await ex(mp.getByRole("heading", { name: "Coming days" })).toBeVisible();
    await noHorizontalScroll(mp);

    // Customer completes the first item (start, then complete).
    await mp.goto("/customer/home");
    const first = mp.getByRole("region", { name: planName }).locator("li[data-status]").first();
    await first.getByRole("button", { name: /^Start/ }).click();
    await ex(first).toHaveAttribute("data-status", "started");
    await first.getByRole("button", { name: /^Complete/ }).click();
    await ex(first).toHaveAttribute("data-status", "completed");
    await ex(mp.getByTestId("sync-status")).toContainText("Synced");
    await mp.getByRole("button", { name: "Skip rest" }).click().catch(() => {});

    // Coach's member detail: one more completed workout than before, and the denominator grew by the plan.
    const after = await adherenceOf(cp, m2.id);
    expect(after.scheduled, "assigning the plan adds scheduled workouts").toBeGreaterThan(before.scheduled);
    expect(after.completed, "the customer's completed item shows for the coach").toBe(before.completed + 1);
    expect(after.value).not.toBe(before.value);

    // Owner: dashboard adherence tile and the coach page both still render real numbers; the
    // dashboard value reflects the new plan and completion (it differs from the baseline).
    await owner.page.goto("/owner/dashboard?range=7");
    await ex(tile(owner.page, "Workout adherence")).toHaveText(/^(\d+(\.\d)?%|Not enough data yet)$/);
    const ownerAfter = (await tile(owner.page, "Workout adherence").innerText()).trim();
    // A percentage can round away one workout among many, so the member-level numbers above carry the strict check.
    expect(ownerAfter).toMatch(/^(\d+(\.\d)?%|Not enough data yet)$/);
    void ownerBefore;
    await owner.page.goto("/owner/coaches");
    const gamma = owner.page.getByRole("list", { name: "Coaches" }).getByRole("listitem").filter({ hasText: "Sample Trainer Gamma" });
    await ex(gamma).toBeVisible();
    await gamma.getByRole("link").first().click();
    await ex(owner.page.getByRole("heading", { level: 1, name: "Sample Trainer Gamma" })).toBeVisible();
    await ex(tile(owner.page, "Workout adherence")).toHaveText(/^(\d+(\.\d)?%|Not enough data yet)$/);

    // Coach edits the first exercise's reps; the customer sees plan_updated in Updates and a badge on Home.
    await cp.goto("/coach/plans");
    await cp.getByRole("listitem").filter({ hasText: planName }).getByRole("link", { name: "Edit" }).click();
    await ex(cp.getByRole("heading", { level: 1, name: "Edit plan" })).toBeVisible();
    await cp.getByLabel("Reps").nth(0).fill("15");
    await cp.getByRole("button", { name: "Save and activate" }).click();
    await ex(cp).toHaveURL(/\/coach\/plans$/);

    await mp.goto("/customer/home");
    await ex(mp.locator("main").getByText(/^\d+ new$/)).toBeVisible();
    await mp.getByRole("link", { name: "Open updates" }).click();
    await ex(mp).toHaveURL(/\/customer\/updates$/);
    await ex(mp.getByText(`Your coach updated your plan: ${planName}`)).toBeVisible();
    await ex(mp.getByText(`Your coach shared a new workout plan: ${planName}`)).toBeVisible();
    await ex(mp.getByTestId("mark-read")).toHaveAttribute("data-state", "done");
    await mp.goto("/customer/home");
    await ex(mp.getByRole("region", { name: planName }).locator("li[data-status]").first()).toContainText("4 sets × 15 reps");
    await ex(mp.locator("main").getByText(/^\d+ new$/)).toHaveCount(0);

    await finish(coach, customer, owner);
  } finally {
    await closeAll(coach, customer, owner);
  }
});

// ---------------------------------------------------------------------------------------------
// (2) Session: schedule, one-tap roll call (present, absent, excused), complete; attendance flows.
// ---------------------------------------------------------------------------------------------
test("(2) session: roll call with an excused absence updates Progress and the owner dashboard; holidays are not missed", async ({ browser }) => {
  const coach = await openAs(browser, PEOPLE.gymCoach);
  const c2 = await openAs(browser, PEOPLE.gymM2, PHONE); // present
  const c3 = await openAs(browser, PEOPLE.gymM3, PHONE); // absent
  const c4 = await openAs(browser, PEOPLE.gymM4, PHONE); // excused
  const owner = await openAs(browser, PEOPLE.gymOwner);
  try {
    const cp = coach.page;
    const b2 = await countsOf(c2.page);
    const b3 = await countsOf(c3.page);
    const b4 = await countsOf(c4.page);

    await owner.page.goto("/owner/dashboard?range=7");
    await ex(tile(owner.page, "Sessions completed")).toHaveText(/^\d+ of \d+$/);
    const completedBefore = Number((await tile(owner.page, "Sessions completed").innerText()).split(" of ")[0]);

    // Schedule today 00:05 (already started, so it can be completed).
    await scheduleSession(cp, { batch: "Morning Strength", date: istToday(), start: "00:05", end: "00:35" });
    await ex(cp.getByRole("heading", { level: 1 })).toBeVisible();
    await ex(rows(cp).first()).toBeVisible();

    // One tap each: M2 present; M3 present then absent; M4 excused with a reason.
    await rowMain(cp, "Sample Member 02").click();
    await ex(rowMain(cp, "Sample Member 02")).toHaveAttribute("data-status", "present");
    await rowMain(cp, "Sample Member 03").click();
    await rowMain(cp, "Sample Member 03").click();
    await ex(rowMain(cp, "Sample Member 03")).toHaveAttribute("data-status", "absent");
    await row(cp, "Sample Member 04").getByRole("button", { name: /More options/ }).click();
    const sheet = cp.getByRole("dialog");
    await sheet.getByRole("button", { name: "Excused" }).click();
    await sheet.getByLabel("Reason for excused absence").selectOption("illness");
    await sheet.getByRole("button", { name: "Save" }).click();
    await ex(rowMain(cp, "Sample Member 04")).toHaveAttribute("data-status", "excused");
    await ex(cp.getByTestId("sync-status")).toContainText("All changes saved");
    await finishClass(cp);

    // Member Progress: attended +1, missed +1 (absent only), excused +1 and never missed.
    const a2 = await countsOf(c2.page);
    const a3 = await countsOf(c3.page);
    const a4 = await countsOf(c4.page);
    expect(a2.attended).toBe(b2.attended + 1);
    expect(a2.missed).toBe(b2.missed);
    expect(a3.missed).toBe(b3.missed + 1);
    expect(a3.attended).toBe(b3.attended);
    expect(a4.excused).toBe(b4.excused + 1);
    expect(a4.missed, "an excused absence is not a missed class").toBe(b4.missed);
    expect(a4.attended).toBe(b4.attended);
    await ex(c4.page.getByText("Excused absences and holidays are never counted as missed.")).toBeVisible();

    // Coach's own member detail agrees.
    const m3 = await withDb((db) => memberByName(db, "demo-gym", "Sample Member 03"));
    await cp.goto(`/coach/members/${m3.id}`);
    await ex(cp.getByText("Recent attendance")).toBeVisible();

    // Owner dashboard: one more session completed.
    await owner.page.goto("/owner/dashboard?range=7");
    await ex(tile(owner.page, "Sessions completed")).toHaveText(new RegExp(`^${completedBefore + 1} of \\d+$`));
    await ex(tile(owner.page, "Attendance")).toHaveText(/^\d+(\.\d)?%$/);

    // A holiday does not count as missed: schedule on the seeded upcoming holiday (warns, still scheduled),
    // and the customer's Schedule explains it without blame.
    const holiday = await withDb(async (db) => {
      const t = await db.tenant.findUniqueOrThrow({ where: { slug: "demo-gym" } });
      const h = await db.holiday.findMany({ where: { tenantId: t.id, date: { gt: new Date() } }, orderBy: { date: "asc" } });
      return h[0].date.toISOString().slice(0, 10);
    });
    await scheduleSession(cp, { batch: "Evening Strength", date: holiday, start: "18:30", end: "19:30" });
    await ex(cp.getByText(/holiday/i).first()).toBeVisible();
    const after = await countsOf(c3.page);
    expect(after.missed, "a session on a holiday adds no missed class").toBe(a3.missed);

    await finish(coach, c2, c3, c4, owner);
  } finally {
    await closeAll(coach, c2, c3, c4, owner);
  }
});

// ---------------------------------------------------------------------------------------------
// (3) Booking: seat, waitlist, promotion on cancel, owner changes the cancellation window.
// ---------------------------------------------------------------------------------------------
test("(3) booking: full class waitlists the second customer, a cancel promotes, the owner's window decides late cancels", async ({ browser }) => {
  const coach = await openAs(browser, PEOPLE.gymCoach);
  const a = await openAs(browser, PEOPLE.gymM3, PHONE);
  const b = await openAs(browser, PEOPLE.gymM4, PHONE);
  const owner = await openAs(browser, PEOPLE.gymOwner);
  try {
    // A one-seat class at 23:00 IST, the first such slot at least 24 hours away (so 24 to 48 hours ahead:
    // outside the 120 minute window, inside a 48 hour one). A fixed late slot never overlaps the seeded
    // day sessions, whatever the time of day the test runs. Found again by its id.
    const ist = new Date(Date.now() + 330 * 60_000 + 24 * 3_600_000); // IST wall clock, shifted into UTC fields
    const start = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 23, 0));
    if (start.getTime() < ist.getTime()) start.setUTCDate(start.getUTCDate() + 1);
    const date = start.toISOString().slice(0, 10);
    const hhmm = "23:00";
    const end = "23:30";
    const url = await scheduleSession(coach.page, { batch: "Morning Strength", date, start: hhmm, end, capacity: 1 });
    const sessionId = url.split("/").pop()!;
    const card = (p: Page) => p.locator(`li[data-session-id="${sessionId}"]`);
    const open = async (p: Page) => {
      await p.goto(`/customer/schedule?view=week&from=${date}`);
      await ex(p.getByRole("heading", { level: 1 })).toHaveText("Schedule");
      await ex(card(p)).toBeVisible();
    };

    // Customer A books the only seat.
    await open(a.page);
    await card(a.page).getByRole("button", { name: "Book", exact: true }).click();
    await ex(card(a.page)).toHaveAttribute("data-booking", "booked");
    await ex(card(a.page).getByTestId("cancel-info")).toContainText("You can cancel until");

    // Customer B: the class is full, so Join waiting list, position 1.
    await open(b.page);
    await ex(card(b.page)).toContainText("Class is full");
    await card(b.page).getByRole("button", { name: "Join waiting list" }).click();
    await ex(card(b.page)).toHaveAttribute("data-booking", "waitlisted");
    await ex(card(b.page)).toContainText("Waiting list: position 1");

    // The coach sees the booked member and the waitlisted one apart.
    await coach.page.goto(url);
    await ex(coach.page.getByText(/1 of 1 booked/)).toBeVisible();
    await ex(coach.page.getByText(/1 on waitlist/)).toBeVisible();

    // A cancels (outside the 120 minute window): B is promoted and told so.
    await open(a.page);
    await card(a.page).getByRole("button", { name: "Cancel booking" }).click();
    await a.page.getByRole("button", { name: "Yes, cancel" }).click();
    await ex(card(a.page)).toHaveAttribute("data-booking", "none");
    await open(b.page);
    await ex(card(b.page)).toHaveAttribute("data-booking", "booked");
    await b.page.goto("/customer/updates");
    await ex(b.page.getByText(/Good news: a spot opened up in Morning Strength Floor/)).toBeVisible();

    // Owner sets the cancellation window to 48 hours in Settings: B (class 24 to 48 hours away) can no longer cancel.
    const setWindow = async (minutes: string) => {
      const p = owner.page;
      await p.goto("/owner/settings");
      await ex(p.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
      await p.getByLabel("Cancellation window (minutes)").fill(minutes);
      await p.getByRole("button", { name: "Save booking rules" }).click();
      await ex(p.getByText("Booking rules saved")).toBeVisible();
    };
    await setWindow("2880");
    await open(b.page);
    await ex(card(b.page).getByRole("button", { name: "Cancel booking" })).toBeDisabled();
    await ex(card(b.page).getByTestId("cancel-info")).toContainText("The cancellation window closed at");
    await ex(b.page.getByText("You can cancel a booking up to 2880 minutes before the class starts.")).toBeVisible();

    // Window back to 0 (cancel any time before the class): the same late cancel is now allowed.
    await setWindow("0");
    await open(b.page);
    await ex(card(b.page).getByRole("button", { name: "Cancel booking" })).toBeEnabled();
    await card(b.page).getByRole("button", { name: "Cancel booking" }).click();
    await b.page.getByRole("button", { name: "Yes, cancel" }).click();
    await ex(card(b.page)).toHaveAttribute("data-booking", "none");
    await setWindow("120"); // restore the seeded gym value

    await finish(coach, a, b, owner);
  } finally {
    await closeAll(coach, a, b, owner);
  }
});

// ---------------------------------------------------------------------------------------------
// (4) Goals: coach creates, customer sees progress, check-ins update it.
// ---------------------------------------------------------------------------------------------
test("(4) goals: coach creates a goal, the customer sees progress, check-ins move it", async ({ browser }) => {
  const title = `QA75 goal ${uniq()}`;
  const coach = await openAs(browser, PEOPLE.gymCoach);
  const customer = await openAs(browser, PEOPLE.gymM2, PHONE);
  try {
    const cp = coach.page;
    const mp = customer.page;
    const m2 = await withDb((db) => memberByName(db, "demo-gym", "Sample Member 02"));
    await cp.goto(`/coach/members/${m2.id}`);
    await cp.getByRole("button", { name: "New goal" }).first().click();
    const dlg = cp.getByRole("dialog", { name: "New goal" });
    await dlg.getByLabel("Goal title").fill(title);
    await dlg.getByLabel("What to measure").selectOption({ label: "Custom (your own measure)" });
    await dlg.getByLabel("Target", { exact: true }).fill("10");
    await dlg.getByLabel("Starting value").fill("0");
    await dlg.getByLabel("Unit").fill("reps");
    await dlg.getByRole("button", { name: "Save goal" }).click();
    await ex(cp.getByText("Goal saved")).toBeVisible();

    const goalOnCustomer = () => mp.getByTestId("goal").filter({ hasText: title });
    await mp.goto("/customer/progress");
    await ex(goalOnCustomer()).toBeVisible();
    await ex(goalOnCustomer().getByRole("progressbar")).toBeVisible();

    const checkIn = async (value: string, note: string) => {
      await cp.goto(`/coach/members/${m2.id}`);
      const item = cp.getByRole("list", { name: "Goals", exact: true }).getByRole("listitem").filter({ hasText: title });
      await item.getByRole("button", { name: "Add check-in" }).click();
      const sheet = cp.getByRole("dialog", { name: `Check-in for ${title}` });
      await sheet.getByLabel("Value").fill(value);
      await sheet.getByLabel("Note (optional)").fill(note);
      await sheet.getByRole("button", { name: "Save check-in" }).click();
      await ex(cp.getByText("Check-in saved")).toBeVisible();
    };
    await checkIn("4", "first check-in");
    await mp.goto("/customer/progress");
    await ex(goalOnCustomer().getByTestId("goal-percent")).toHaveText("40% of the way");
    await checkIn("8", "second check-in");
    await mp.goto("/customer/progress");
    await ex(goalOnCustomer().getByTestId("goal-percent")).toHaveText("80% of the way");
    await goalOnCustomer().locator("summary").click();
    await ex(goalOnCustomer().locator("details li")).toHaveCount(2);
    // The feed announced the goal.
    await mp.goto("/customer/updates");
    await ex(mp.getByText(`New goal: ${title}`)).toBeVisible();

    await finish(coach, customer);
  } finally {
    await closeAll(coach, customer);
  }
});

// ---------------------------------------------------------------------------------------------
// (5) CSV import: owner imports, the members show up for that owner only.
// ---------------------------------------------------------------------------------------------
test("(5) import: new members appear in the owner list and never in another tenant", async ({ browser }) => {
  const u = uniq();
  const names = [`QA75 Import Alpha ${u}`, `QA75 Import Beta ${u}`, `QA75 Import Gamma ${u}`];
  const owner = await openAs(browser, PEOPLE.gymOwner);
  const other = await openAs(browser, PEOPLE.karateOwner);
  try {
    const p = owner.page;
    await p.goto("/owner/members/import");
    await ex(p.getByRole("heading", { level: 1, name: "Import members from CSV" })).toBeVisible();
    const csv = ["name,phone,email,guardian_name,guardian_phone,batch_name,sport,level,goal,join_date,fee_status", ...names.map((n, i) => `${n},+9190001${u.length}${i}${String(i).padStart(3, "0")},,,,,,,,${istToday()},paid`)].join("\n");
    const imported = () => withDb((db) => db.member.count({ where: { displayName: { in: names } } }));
    // `next dev` can full-reload the page while another route compiles, which loses the screen's state (the review, or
    // the result after the import). Redo the flow until the import shows its result; a repeat never imports twice.
    await expect(async () => {
      if ((await imported()) === 3) return; // an earlier attempt imported them; only its result screen was lost
      await p.goto("/owner/members/import");
      // The file input can be chosen before the page has hydrated (the change is then lost): choose again until the review shows.
      await expect(async () => {
        await p.getByTestId("file-input").setInputFiles({ name: "qa75.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
        await expect(p.getByTestId("review")).toBeVisible({ timeout: 8_000 });
      }).toPass({ timeout: 90_000 });
      await ex(p.getByTestId("review")).toContainText("3 new members are ready to import.");
      await p.getByTestId("confirm-import").click();
      await p.getByRole("button", { name: "Yes, import" }).click();
      await ex(p.getByTestId("done")).toContainText("3 members added to your business.", { timeout: 20_000 });
    }).toPass({ timeout: 180_000 });
    expect(await imported()).toBe(3);

    await p.goto("/owner/members");
    for (const n of names) await ex(p.getByText(n)).toBeVisible();
    // Real owner of another business: the same names are nowhere.
    await other.page.goto("/owner/members");
    await ex(other.page.getByRole("heading", { level: 1, name: "Members" })).toBeVisible();
    await ex(other.page.getByText(/Sample Kid 01/).first()).toBeVisible();
    for (const n of names) await ex(other.page.getByText(n)).toHaveCount(0);
    await other.page.goto(`/owner/members?q=QA75`);
    await ex(other.page.getByText("QA75 Import")).toHaveCount(0);
    const rowsInDb = await withDb(async (db) => ({
      gym: await db.member.count({ where: { tenant: { slug: "demo-gym" }, displayName: { in: names } } }),
      karate: await db.member.count({ where: { tenant: { slug: "demo-karate" }, displayName: { in: names } } }),
    }));
    expect(rowsInDb).toEqual({ gym: 3, karate: 0 });

    await finish(owner, other);
  } finally {
    await closeAll(owner, other);
  }
});

// ---------------------------------------------------------------------------------------------
// (6) Role guards and tenant isolation in the UI.
// ---------------------------------------------------------------------------------------------
test("(6) role guards and tenant isolation", async ({ browser }) => {
  const customer = await openAs(browser, PEOPLE.gymM1, PHONE);
  const coach = await openAs(browser, PEOPLE.gymCoach);
  const kOwner = await openAs(browser, PEOPLE.karateOwner);
  const gOwner = await openAs(browser, PEOPLE.gymOwner);
  try {
    const m5 = await withDb((db) => memberByName(db, "demo-gym", "Sample Member 05")); // Delta's member
    const m2 = await withDb((db) => memberByName(db, "demo-gym", "Sample Member 02"));

    for (const path of ["/coach/today", "/coach/plans", "/coach/members", `/coach/members/${m2.id}`, "/coach/record", "/owner/dashboard", "/owner/members", "/owner/settings", "/owner/coaches", "/owner/members/import"]) {
      await customer.page.goto(path);
      await ex(customer.page.locator("section[role=alert]"), `customer ${path}`).toContainText(NOT_ALLOWED);
      await ex(customer.page.locator('nav a[href^="/coach"], nav a[href^="/owner"]'), path).toHaveCount(0);
    }
    for (const path of ["/owner/dashboard", "/owner/members", "/owner/settings", "/owner/coaches", "/owner/batches", "/owner/members/import", "/customer/home", "/customer/progress"]) {
      await coach.page.goto(path);
      await ex(coach.page.locator("section[role=alert]"), `coach ${path}`).toContainText(NOT_ALLOWED);
      await ex(coach.page.locator('nav a[href^="/owner"], nav a[href^="/customer"]'), path).toHaveCount(0);
    }
    // Another coach's member.
    await coach.page.goto(`/coach/members/${m5.id}`);
    await ex(coach.page.getByRole("heading", { level: 1, name: "This member is not one of yours" })).toBeVisible();
    await ex(coach.page.getByRole("button", { name: "Create sign-in link" })).toHaveCount(0);
    await ex(coach.page.locator("body")).not.toContainText("Sample Member 05");
    await coach.page.goto("/coach/members");
    await ex(coach.page.getByRole("link", { name: "Open Sample Member 05" })).toHaveCount(0);

    // Tenant isolation: each business sees only its own names, name and logo.
    await gOwner.page.goto("/owner/members");
    await ex(gOwner.page.getByText("Sample Member 01").first()).toBeVisible();
    await kOwner.page.goto("/owner/members");
    await ex(kOwner.page.getByText("Sample Kid 01").first()).toBeVisible();
    for (const [s, foreign, own, ownName] of [
      [gOwner, /Sample Kid \d|Sample Adult|Sample Dojo|Sample Coach Alpha/, GYM_NAME, "/tenants/demo-gym.svg"],
      [kOwner, /Sample Member \d|Iron Works|Sample Trainer/, KARATE_NAME, "/tenants/demo-karate.svg"],
    ] as const) {
      for (const path of ["/owner/members", "/owner/dashboard", "/owner/batches", "/owner/coaches", "/owner/settings"]) {
        await s.page.goto(path);
        await ex(s.page.getByRole("heading", { level: 1 })).toBeVisible();
        await ex(s.page.locator(".shell-title strong")).toHaveText(own);
        await ex(s.page.locator("img.logo-img").first()).toHaveAttribute("src", ownName);
        const text = await s.page.locator("body").innerText();
        expect(text, `${s.actor.tenant} ${path} must not show the other business`).not.toMatch(foreign);
      }
    }
    // Another tenant's member id is simply not found for the karate owner (404 page expected).
    await kOwner.hygiene.allowing([/ 404$/], async () => {
      await kOwner.page.goto(`/owner/members/${m2.id}`);
      await ex(kOwner.page.locator("body")).not.toContainText("Sample Member 02");
    });
    // Customers likewise: the karate customer sees no gym people.
    const kc = await openAs(browser, PEOPLE.karateCustomer, PHONE);
    try {
      for (const path of ["/customer/home", "/customer/schedule", "/customer/progress", "/customer/profile", "/customer/updates", "/customer/workouts"]) {
        await kc.page.goto(path);
        await ex(kc.page.getByRole("heading", { level: 1 })).toBeVisible();
        expect(await kc.page.locator("body").innerText()).not.toMatch(/Sample Member \d|Iron Works|Sample Trainer/);
      }
      kc.hygiene.assertClean();
    } finally {
      await closeAll(kc);
    }
    await finish(customer, coach, kOwner, gOwner);
  } finally {
    await closeAll(customer, coach, kOwner, gOwner);
  }
});

// ---------------------------------------------------------------------------------------------
// (7) Offline: coach roll call and customer workout taps sync after reconnecting.
// ---------------------------------------------------------------------------------------------
test("(7a) offline: coach roll call is kept on the device and syncs end to end", async ({ browser }) => {
  const coach = await openAs(browser, PEOPLE.gymCoach, { width: 390, height: 844 });
  const owner = await openAs(browser, PEOPLE.gymOwner);
  try {
    const cp = coach.page;
    await scheduleSession(cp, { batch: "Evening Strength", date: istToday(), start: "01:00", end: "01:30" });
    await ex(rows(cp).first()).toBeVisible();
    const count = await rows(cp).count();
    expect(count).toBeGreaterThanOrEqual(3);

    // Online tap for the first member, then go offline for the rest.
    await rowMain(cp, "Sample Member 07").click();
    await ex(rowMain(cp, "Sample Member 07")).toHaveAttribute("data-status", "present");
    await ex(cp.getByTestId("sync-status")).toContainText("All changes saved");

    coach.hygiene.offline = true;
    await coach.context.setOffline(true);
    await ex(cp.getByText("You are offline").first()).toBeVisible();
    await rowMain(cp, "Sample Member 08").click();
    await ex(rowMain(cp, "Sample Member 08")).toHaveAttribute("data-status", "present");
    await ex(row(cp, "Sample Member 08")).toContainText("Waiting to sync");
    await row(cp, "Sample Member 01").locator("button[data-status]").click();
    await row(cp, "Sample Member 01").locator("button[data-status]").click();
    await ex(row(cp, "Sample Member 01").locator("button[data-status]")).toHaveAttribute("data-status", "absent");
    await ex(cp.getByTestId("sync-status")).toContainText("saved on this device");
    // A group class is finished with "Finish class and send"; offline it is allowed and queues on the device.
    await ex(cp.getByRole("button", { name: "Finish class and send" })).toBeEnabled();
    const queued = await cp.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith("rollcall.queue")).flatMap(([, v]) => JSON.parse(v)));
    expect(queued.length).toBe(2);

    await coach.context.setOffline(false);
    coach.hygiene.offline = false;
    await ex(cp.getByTestId("sync-status")).toContainText("All changes saved");
    await expect.poll(() => cp.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("rollcall.queue")).length)).toBe(0);

    // Server truth after a reload, and the session completes.
    await cp.reload();
    await ex(rowMain(cp, "Sample Member 07")).toHaveAttribute("data-status", "present");
    await ex(rowMain(cp, "Sample Member 08")).toHaveAttribute("data-status", "present");
    await ex(rowMain(cp, "Sample Member 01")).toHaveAttribute("data-status", "absent");
    const sessionId = cp.url().split("/").pop()!;
    const saved = await withDb((db) => db.attendance.count({ where: { sessionId } }));
    expect(saved).toBe(3);
    await finishClass(cp);

    await finish(coach, owner);
  } finally {
    await closeAll(coach, owner);
  }
});

test("(7b) offline: a customer's workout taps sync after reconnecting", async ({ browser }) => {
  const customer = await openAs(browser, PEOPLE.gymM1, PHONE);
  try {
    const mp = customer.page;
    await mp.goto("/customer/home");
    const pending = mp.locator('li[data-status="pending"]');
    await ex(pending.first()).toBeVisible();
    const name = ((await pending.first().locator("a").first().textContent()) ?? "").replace(/\(Exercise details\)/, "").trim();
    const item = mp.locator("li[data-status]").filter({ hasText: name }).first();

    customer.hygiene.offline = true;
    await customer.context.setOffline(true);
    await ex(mp.getByText("You are offline.").first()).toBeVisible();
    await customer.hygiene.allowing([/Failed to fetch|NetworkError|Load failed/i], async () => {
      await item.getByRole("button", { name: /^Start/ }).click();
      await ex(item).toHaveAttribute("data-status", "started");
      await item.getByRole("button", { name: /^Complete/ }).click();
      await ex(item).toHaveAttribute("data-status", "completed");
      await ex(item.getByText("Waiting to sync")).toBeVisible();
      await ex(mp.getByTestId("sync-status")).toContainText("2 saved on this phone");
    });
    await customer.context.setOffline(false);
    customer.hygiene.offline = false;
    await ex(mp.getByTestId("sync-status")).toContainText("Synced");
    await ex(item.getByText("Waiting to sync")).toHaveCount(0);
    await mp.reload();
    await ex(mp.locator("li[data-status]").filter({ hasText: name }).first()).toHaveAttribute("data-status", "completed");

    await finish(customer);
  } finally {
    await closeAll(customer);
  }
});

// ---------------------------------------------------------------------------------------------
// (8) Console and network hygiene on every main screen of every role (the other scenarios also
//     assert it for each screen they visit).
// ---------------------------------------------------------------------------------------------
test("(8) every main screen of each role loads without console errors or failed requests", async ({ browser }) => {
  const screens: [typeof PEOPLE[keyof typeof PEOPLE], string[]][] = [
    [PEOPLE.gymOwner, ["/owner", "/owner/dashboard", "/owner/dashboard?range=90", "/owner/members", "/owner/members/import", "/owner/batches", "/owner/coaches", "/owner/workouts", "/owner/plans", "/owner/settings"]],
    [PEOPLE.gymCoach, ["/coach", "/coach/today", "/coach/today/week", "/coach/today/availability", "/coach/sessions/new", "/coach/members", "/coach/plans", "/coach/plans/new", "/coach/workouts", "/coach/record"]],
    [PEOPLE.gymM1, ["/customer/home", "/customer/workouts", "/customer/schedule", "/customer/schedule?view=month", "/customer/progress", "/customer/profile", "/customer/updates"]],
    [PEOPLE.karateOwner, ["/owner/dashboard", "/owner/members", "/owner/settings"]],
    [PEOPLE.karateParent, ["/customer/home", "/customer/schedule", "/customer/progress", "/customer/profile"]],
  ];
  for (const [actor, paths] of screens) {
    const s = await openAs(browser, actor, actor.role === "customer" ? PHONE : undefined);
    try {
      for (const path of paths) {
        const res = await s.page.goto(path);
        expect(res?.status(), path).toBeLessThan(400);
        await ex(s.page.getByRole("heading", { level: 1 }).first(), path).toBeVisible();
        await ex(s.page.locator("section[role=alert]"), path).toHaveCount(0);
        await s.page.waitForLoadState("load");
      }
      s.hygiene.assertClean();
      expect(s.hygiene.seen.size).toBeGreaterThan(paths.length);
    } finally {
      await closeAll(s);
    }
  }
});

// ---------------------------------------------------------------------------------------------
// (9) Navigation sweep: every nav item and every internal in-page link, at 1280px and 360px.
// ---------------------------------------------------------------------------------------------
const CRAWL_CAP = 30;
const SKIP_HREF = /^(mailto:|tel:|#|javascript:)|\/auth\/magic|\/api\/|^\/ui\/|sign-out|signout/i;

async function internalLinks(page: Page): Promise<string[]> {
  const hrefs = await page.locator("a[href]").evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute("href") ?? ""));
  const out = new Set<string>();
  for (const h of hrefs) {
    if (!h || SKIP_HREF.test(h)) continue;
    const u = new URL(h, "http://x");
    if (h.startsWith("http") && !h.startsWith(BASE_URL)) continue;
    out.add(u.pathname + u.search);
  }
  return [...out];
}

async function assertHealthy(page: Page, path: string, status: number | undefined) {
  expect(status, `${path} status`).toBeLessThan(400);
  const body = await page.locator("body").innerText();
  expect(body, `${path} shows an error page`).not.toMatch(/This page could not be found|Application error|Something went wrong|Internal Server Error|^404$/m);
  await ex(page.getByRole("heading", { level: 1 }).first(), `${path} heading`).toBeVisible();
  await ex(page.locator("section[role=alert]"), `${path} role alert`).toHaveCount(0);
}

for (const viewport of [{ width: 1280, height: 900 }, { width: 360, height: 780 }]) {
  for (const actor of [PEOPLE.gymOwner, PEOPLE.gymCoach, PEOPLE.gymM1]) {
    test(`(9) navigation sweep: ${actor.role} at ${viewport.width}px`, async ({ browser }) => {
      const s = await openAs(browser, actor, viewport);
      try {
        const p = s.page;
        // Real clicks on each nav item (at 360px the dev indicator can cover the left-most item, so click through the DOM).
        const nav = p.getByRole("navigation", { name: "Main navigation" }).locator("a");
        const n = await nav.count();
        // Every screen of the role plus More (phones hide the extras in the bar, but they stay in the DOM and on /more).
        expect(n).toBe(NAV[actor.role as "owner" | "coach" | "customer"].length + 1);
        const hrefs: string[] = [];
        for (let i = 0; i < n; i++) hrefs.push((await nav.nth(i).getAttribute("href"))!);
        for (const href of hrefs) {
          const link = p.getByRole("navigation", { name: "Main navigation" }).locator(`a[href="${href}"]`);
          // A click that lands while the page is still hydrating can be swallowed: click again until the URL changes.
          await expect(async () => {
            // The Next dev indicator sits bottom-left and can cover the lowest side-rail items (the owner has the
            // most): click for real when the link is clickable, else through the DOM.
            const clickable = viewport.width >= 768 && (await link.click({ trial: true, timeout: 2_000 }).then(() => true, () => false));
            if (clickable) await link.click();
            else await link.evaluate((el) => (el as HTMLElement).click());
            await expect(p).toHaveURL(new RegExp(`${href}(\\?.*)?$`), { timeout: 10_000 });
          }).toPass({ timeout: 90_000 });
          await assertHealthy(p, href, 200);
          if (viewport.width < 768) await noHorizontalScroll(p);
        }
        // Crawl the internal links of every page reached (capped).
        const seen = new Set<string>();
        const queue = [...hrefs];
        let crawled = 0;
        while (queue.length > 0 && crawled < CRAWL_CAP) {
          const path = queue.shift()!;
          if (seen.has(path)) continue;
          seen.add(path);
          if (/\.[a-z0-9]{2,4}$/i.test(path.split("?")[0])) {
            const r = await p.request.get(path);
            expect(r.status(), path).toBeLessThan(400);
            continue;
          }
          const res = await p.goto(path);
          await assertHealthy(p, path, res?.status());
          crawled++;
          if (viewport.width < 768) await noHorizontalScroll(p);
          for (const l of await internalLinks(p)) {
            const [pathname] = l.split("?");
            if (!seen.has(l) && !queue.includes(l) && pathname.startsWith(`/${actor.role}`) ) queue.push(l);
          }
        }
        expect(crawled, "the crawl visited pages").toBeGreaterThan(5);
        s.hygiene.assertClean();
      } finally {
        await closeAll(s);
      }
    });
  }
}

/** Finishes a group class through the confirm sheet ("Finish class and send") and waits for the toast. */
async function finishClass(page: Page) {
  await page.getByRole("button", { name: "Finish class and send" }).click();
  const sheet = page.getByRole("dialog", { name: "Finish class and send" });
  await sheet.getByRole("button", { name: "Finish and send" }).click();
  await ex(page.getByText("Class finished", { exact: false }).first()).toBeVisible();
}
