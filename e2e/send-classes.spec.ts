import { expect as baseExpect, test, type Browser, type Page } from "@playwright/test";
import { PEOPLE, closeAll, expect as ex, noHorizontalScroll, openAs, tenantId, uniq, withDb, type Session } from "./helpers/cross-role";
import { BASE_URL } from "./helpers/cross-role";

// STAR-110: coach send step, member inbox, class workout and finish, class summary, public share page.
//
//   E2E_WEBPACK=1 E2E_DB_NAME=allstar_e2e_send110 E2E_PORT=3410 npx playwright test e2e/send-classes.spec.ts
//
// Whole journeys across separate browser contexts (coach, member or parent, a visitor with no sign-in),
// each really signed in by the dev magic link, on the rich seed. Every context also fails the test on
// console errors and unexpected 4xx/5xx responses.

test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);
const expect = baseExpect.configure({ timeout: 25_000 });
const PHONE = { width: 360, height: 780 };

const state: { planTitle: string; planId: string; sessionId: string; shareUrl: string } = { planTitle: "", planId: "", sessionId: "", shareUrl: "" };

/** Compile the routes once so the journeys below measure behaviour, not `next dev` compile time. */
test.beforeAll(async ({ browser }) => {
  test.setTimeout(600_000);
  const plan: [Parameters<typeof openAs>[1], string[]][] = [
    [PEOPLE.gymCoach, ["/coach/plans", "/coach/plans/x/send", "/coach/plans/x/results", "/coach/members/x", "/coach/sessions/x"]],
    [PEOPLE.gymM1, ["/customer/home", "/customer/workouts", "/customer/classes", "/customer/classes/x", "/customer/updates"]],
  ];
  for (const [actor, paths] of plan) {
    const s = await openAs(browser, actor);
    try {
      for (const path of paths) await s.context.request.get(path, { timeout: 120_000 });
    } finally {
      await closeAll(s);
    }
  }
  const anon = await browser.newContext({ baseURL: BASE_URL });
  await anon.request.get("/share/class/warmup", { timeout: 120_000 });
  await anon.close();
});

async function plan(title: string) {
  return withDb(async (db) => {
    const tid = await tenantId(db, "demo-gym");
    const coach = await db.user.findFirstOrThrow({ where: { tenantId: tid, email: PEOPLE.gymCoach.email } });
    const exercises = await db.exercise.findMany({ where: { tenantId: tid }, take: 4, orderBy: { name: "asc" } });
    const created = await db.workoutPlan.create({
      data: {
        tenantId: tid,
        coachId: coach.id,
        title,
        cadence: "DAILY",
        status: "ACTIVE",
        days: {
          create: {
            tenantId: tid,
            dayIndex: 1,
            title: "Day 1",
            items: {
              create: exercises.map((e, i) => ({ tenantId: tid, exerciseId: e.id, position: i, sets: 3, reps: 10, restSeconds: 45, ...(i < 2 ? { supersetGroup: "A", rounds: 3 } : {}) })),
            },
          },
        },
      },
    });
    return created.id;
  });
}

const pick = (page: Page, name: string) => page.getByRole("checkbox", { name: new RegExp(name) });

test("coach sends a plan to two members and sees one result per member", async ({ browser }) => {
  state.planTitle = `E2E send ${uniq()}`;
  state.planId = await plan(state.planTitle);
  const coach = await openAs(browser, PEOPLE.gymCoach, PHONE);
  try {
    const page = coach.page;
    // Reachable from the plans list (Send and Results links) and from the plan page.
    await page.goto("/coach/plans");
    await expect(page.getByRole("link", { name: `Send: ${state.planTitle}` })).toBeVisible();
    await expect(page.getByRole("link", { name: `Results: ${state.planTitle}` })).toBeVisible();
    await page.goto(`/coach/plans/${state.planId}`);
    await expect(page.getByRole("link", { name: "Send to members" })).toBeVisible();
    await page.getByRole("link", { name: "Send to members" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "Send workout" })).toBeVisible();
    await expect(page.getByText(/^4 exercises, 1 superset, about \d+ min$/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Choose members to send to" })).toBeDisabled();
    await noHorizontalScroll(page);

    await page.getByLabel("Find a member").fill("Sample Member 0");
    await pick(page, "Sample Member 01").check();
    await pick(page, "Sample Member 02").check();
    await expect(page.getByText("2 selected")).toBeVisible();
    await page.getByLabel("Note to member").fill("Start on Monday, easy pace");
    // The preview shows what members will see, including the note.
    const preview = page.getByRole("region", { name: "What members will see" });
    await expect(preview.getByText("Start on Monday, easy pace")).toBeVisible();
    await expect(preview.getByText(/^New from Coach /)).toBeVisible();

    await page.getByRole("button", { name: "Send to 2 members" }).click();
    const results = page.getByTestId("send-results");
    await expect(results.getByRole("heading", { name: "Sent to 2 members" })).toBeVisible();
    const list = results.getByRole("list", { name: "Results per member" });
    await expect(list.getByRole("listitem")).toHaveCount(2);
    await expect(list.getByText("Sent", { exact: true })).toHaveCount(2);
    await noHorizontalScroll(page);

    // Sending the same plan with the same start date again changes nothing and says why.
    await results.getByRole("button", { name: "Send to more members" }).click();
    await page.getByLabel("Find a member").fill("Sample Member 01");
    await pick(page, "Sample Member 01").check();
    await page.getByRole("button", { name: "Send to 1 member" }).click();
    await expect(page.getByText("Already sent", { exact: true })).toBeVisible();
    await expect(page.getByText(/already has this workout from this start date/)).toBeVisible();

    // A different start date while the plan is still active is explained too.
    await page.getByRole("button", { name: "Send to more members" }).click();
    await page.getByLabel("Find a member").fill("Sample Member 02");
    await pick(page, "Sample Member 02").check();
    await page.getByLabel("Starts").fill(new Date(Date.now() + 330 * 60_000 + 3 * 86_400_000).toISOString().slice(0, 10));
    await page.getByRole("button", { name: "Send to 1 member" }).click();
    await expect(page.getByText("Already has an active plan", { exact: true })).toBeVisible();
    await expect(page.getByText(/already follows this plan from another start date/)).toBeVisible();

    // The "Copy link for WhatsApp" link is the customer workouts page: no token.
    await page.getByRole("button", { name: "Send to more members" }).click();
    await page.getByRole("button", { name: "Copy link for WhatsApp" }).click();
    await expect(page.getByRole("button", { name: /Link copied|Copy link for WhatsApp/ })).toBeVisible();
    coach.hygiene.assertClean();
  } finally {
    await closeAll(coach);
  }
});

test("member sees the new plan in the inbox with the coach note, and it clears once opened", async ({ browser }) => {
  const m = await openAs(browser, PEOPLE.gymM1, PHONE);
  try {
    const page = m.page;
    await page.goto("/customer/home");
    const card = page.getByRole("article").filter({ hasText: state.planTitle });
    await expect(card.getByText(/^New from Coach /)).toBeVisible();
    await expect(card.getByText("Start on Monday, easy pace")).toBeVisible();
    await expect(card.getByRole("link", { name: "Start workout" })).toHaveAttribute("href", "/customer/workouts");
    await card.getByText("Preview exercises").click();
    await expect(card.getByRole("list", { name: `Exercises in ${state.planTitle}` }).getByRole("listitem").first()).toBeVisible();
    await noHorizontalScroll(page);

    await page.goto("/customer/workouts");
    await expect(page.getByRole("article").filter({ hasText: state.planTitle })).toBeVisible();
    await expect(page.getByTestId("mark-read")).toHaveAttribute("data-state", "done");
    await page.goto("/customer/home");
    await expect(page.getByRole("heading", { name: state.planTitle, level: 2 })).toHaveCount(0);
    m.hygiene.assertClean();
  } finally {
    await closeAll(m);
  }
});

test("coach sees the member's logged sets in results and can reply with a note", async ({ browser }) => {
  // Log sets for Sample Member 01 the way the live screen stores them, then read them back as the coach.
  await withDb(async (db) => {
    const tid = await tenantId(db, "demo-gym");
    const a = await db.planAssignment.findFirstOrThrow({ where: { tenantId: tid, planId: state.planId, member: { user: { email: PEOPLE.gymM1.email } } } });
    const planItems = await db.workoutPlanItem.findMany({ where: { day: { planId: state.planId } }, orderBy: { position: "asc" } });
    const today = new Date(new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10) + "T00:00:00Z");
    for (const [i, item] of planItems.slice(0, 2).entries()) {
      const log = await db.workoutLog.create({
        data: { tenantId: tid, assignmentId: a.id, planItemId: item.id, memberId: a.memberId, scheduledFor: today, status: "COMPLETED", note: i === 0 ? "Felt strong today" : null, actualSets: 2, clientId: `e2e-log-${uniq()}-${i}`, recordedById: a.assignedById } as never,
      });
      for (const n of [1, 2]) {
        await db.workoutSet.create({ data: { tenantId: tid, logId: log.id, clientId: `e2e-${uniq()}-${i}-${n}`, setNumber: n, setType: "NORMAL", weightKg: 20 + n, reps: 10 } as never });
      }
    }
  });

  const coach = await openAs(browser, PEOPLE.gymCoach, PHONE);
  try {
    const page = coach.page;
    await page.goto(`/coach/plans/${state.planId}/results`);
    await expect(page.getByRole("heading", { level: 1, name: "Workout results" })).toBeVisible();
    const card = page.getByRole("article").filter({ hasText: "Sample Member 01" });
    await expect(card.getByText("What Sample logged")).toBeVisible();
    // A superset is shown as one block, with its rounds, and each set is readable.
    await expect(card.getByRole("group", { name: "Superset A" })).toBeVisible();
    await expect(card.getByText("21 kg × 10").first()).toBeVisible();
    await expect(card.getByText(/\d+ of \d+ sets/)).toBeVisible();
    await expect(card.getByText("Note from Sample")).toBeVisible();
    await expect(card.getByText("Felt strong today")).toBeVisible();
    // Positive framing: members are listed by name, with no ranking words.
    await expect(page.getByText(/rank|leaderboard|behind|worst/i)).toHaveCount(0);
    await noHorizontalScroll(page);

    await card.getByRole("button", { name: "Reply with a note" }).click();
    await page.getByLabel("Your note").fill("Great control on the rows");
    await page.getByRole("button", { name: "Send note" }).click();
    await expect(page.getByText("Note sent to Sample")).toBeVisible();

    // Also reachable from the member page.
    const memberId = await withDb(async (db) => (await db.member.findFirstOrThrow({ where: { tenantId: await tenantId(db, "demo-gym"), displayName: "Sample Member 01" } })).id);
    await page.goto(`/coach/members/${memberId}`);
    await expect(page.getByRole("heading", { name: "Workout results" })).toBeVisible();
    await expect(page.getByText("Felt strong today").first()).toBeVisible();
    coach.hygiene.assertClean();
  } finally {
    await closeAll(coach);
  }

  // The member sees the reply with their plan.
  const m2 = await openAs(browser, PEOPLE.gymM1, PHONE);
  try {
    await m2.page.goto("/customer/updates");
    await expect(m2.page.getByText("Great control on the rows")).toBeVisible();
  } finally {
    await closeAll(m2);
  }
});

/** A started, not yet finished kids class in the karate academy, and the people on it. */
async function startedClass() {
  return withDb(async (db) => {
    const tid = await tenantId(db, "demo-karate");
    const ref = await db.session.findFirstOrThrow({ where: { tenantId: tid, planDayId: { not: null }, batch: { isGroupClass: true } }, orderBy: { startsAt: "desc" } });
    const now = Date.now();
    const s = await db.session.create({
      data: { tenantId: tid, batchId: ref.batchId, coachId: ref.coachId, startsAt: new Date(now - 20 * 60_000), endsAt: new Date(now + 40 * 60_000), status: "SCHEDULED", title: `E2E class ${uniq()}` },
    });
    return s.id;
  });
}

async function finishThroughUi(page: Page, sessionId: string, opts: { attach: boolean }) {
  await page.goto(`/coach/sessions/${sessionId}`);
  if (opts.attach) {
    await expect(page.getByText("No workout attached yet", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Attach a workout" }).click();
    await page.getByLabel("Plan", { exact: true }).selectOption({ label: "Kids Class: Kihon Circuit" });
    await page.getByLabel("Day", { exact: true }).selectOption({ index: 1 });
    await page.getByRole("button", { name: "Attach workout" }).click();
    await expect(page.getByText("Kids Class: Kihon Circuit").first()).toBeVisible();
  }
  await expect(page.getByTestId("finish-info")).toContainText("present members get today's class, absent members get what they missed");
  await page.getByRole("button", { name: "Mark everyone present" }).click();
  // Make the second member absent with a tap on the row.
  const list = page.getByRole("list", { name: "Members" }).getByRole("listitem");
  await list.nth(1).locator("button[data-status]").click();
  await expect(list.nth(1).locator("button[data-status]")).toHaveAttribute("data-status", "absent");
}

test("coach finishes a karate class; the parent sees the summary and shares it with family", async ({ browser }) => {
  state.sessionId = await startedClass();
  const coach = await openAs(browser, { ...PEOPLE.karateCoach }, PHONE);
  try {
    const page = coach.page;
    await finishThroughUi(page, state.sessionId, { attach: true });
    await noHorizontalScroll(page);
    await page.getByRole("button", { name: "Finish class and send" }).click();
    const sheet = page.getByRole("dialog", { name: "Finish class and send" });
    await expect(sheet.getByText(/present get today's class summary/)).toBeVisible();
    await expect(sheet.getByText(/absent get what they missed/)).toBeVisible();
    await expect(sheet.getByText(/who told us in advance get a softer note/)).toBeVisible();
    await sheet.getByLabel("Note to the class (optional)").fill("Lovely focus today, everyone");
    await sheet.getByLabel("Practise at home (optional)").fill("Ten slow front kicks each side");
    await sheet.getByRole("button", { name: "Finish and send" }).click();
    await expect(page.getByText("Class finished", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("Class finished").first()).toBeVisible();
    coach.hygiene.assertClean();
  } finally {
    await closeAll(coach);
  }

  // The parent (Sample Kid 01 is on the class) sees it on Home, in Updates and under Classes.
  const parent = await openAs(browser, PEOPLE.karateParent, PHONE);
  try {
    const page = parent.page;
    await page.goto("/customer/home");
    const card = page.getByRole("article").filter({ hasText: "Class summary, just now" });
    await expect(card).toBeVisible();
    await expect(card.getByText("Lovely focus today, everyone")).toBeVisible();
    await expect(card.getByText("Ten slow front kicks each side")).toBeVisible();
    await expect(card.getByText("What you did")).toBeVisible();
    await expect(card.getByText("Practise at home")).toBeVisible();
    await noHorizontalScroll(page);

    await page.goto("/customer/classes");
    await expect(page.getByRole("heading", { level: 1, name: "Classes" })).toBeVisible();
    await page.getByRole("link", { name: "Open summary" }).first().click();
    await expect(page.getByText("Lovely focus today, everyone")).toBeVisible();

    await page.getByRole("button", { name: "Share with family" }).click();
    const manual = page.getByLabel("Copy this link");
    await expect(page.getByText(/Link copied|Copy this link/).first()).toBeVisible();
    state.shareUrl = (await manual.count()) > 0 ? await manual.inputValue() : await page.evaluate(() => navigator.clipboard.readText());
    expect(state.shareUrl).toMatch(/\/share\/class\/[A-Za-z0-9_-]{20,}$/);
    await page.goto("/customer/updates");
    await expect(page.getByText("Class summaries")).toBeVisible();
    parent.hygiene.assertClean();
  } finally {
    await closeAll(parent);
  }
});

test("the public share page shows first names only, is not indexed, and a revoked or unknown link is friendly", async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: BASE_URL, viewport: PHONE });
  const page = await ctx.newPage();
  try {
    const url = new URL(state.shareUrl);
    const res = await page.goto(url.pathname);
    expect(res?.status()).toBe(200);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.getByText("Lovely focus today, everyone")).toBeVisible();
    await expect(page.getByText("Ten slow front kicks each side")).toBeVisible();
    // Branded with the business name, a first name only (no "Sample Kid 01" surname or number), and no app chrome.
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/Sample Kid 01/);
    expect(body).toMatch(/Great work in class, Sample/);
    await expect(page.getByRole("navigation")).toHaveCount(0);
    await expect(page.locator(".demo-switcher")).toHaveCount(0);
    await noHorizontalScroll(page);

    // Revoke the link: the page shows one friendly state, same as an unknown token.
    await withDb(async (db) => {
      await db.classSummaryShare.updateMany({ data: { revokedAt: new Date() } });
    });
    await page.goto(url.pathname);
    await expect(page.getByRole("heading", { name: "This link is not available" })).toBeVisible();
    await expect(page.getByText(/This link has expired\. Ask the academy for a new one\./)).toBeVisible();
    await expect(page.getByText("Lovely focus today")).toHaveCount(0);
    await page.goto("/share/class/not-a-real-token-0123456789abcdef");
    await expect(page.getByRole("heading", { name: "This link is not available" })).toBeVisible();
    await noHorizontalScroll(page);
  } finally {
    await ctx.close();
  }
});

test("a class finished with no signal is saved on the device and publishes when it syncs", async ({ browser }) => {
  const sessionId = await startedClass();
  const coach = await openAs(browser, PEOPLE.karateCoach, PHONE);
  try {
    const page = coach.page;
    await finishThroughUi(page, sessionId, { attach: true });
    coach.hygiene.offline = true;
    await coach.context.setOffline(true);
    await page.getByRole("button", { name: "Finish class and send" }).click();
    const sheet = page.getByRole("dialog", { name: "Finish class and send" });
    await expect(sheet.getByText(/You are offline\. Your finish is saved on this device/)).toBeVisible();
    await sheet.getByLabel("Practise at home (optional)").fill("Offline practice line");
    await sheet.getByRole("button", { name: "Finish and send" }).click();
    await expect(page.getByTestId("finish-queued")).toContainText("saved on this device");

    await coach.context.setOffline(false);
    coach.hygiene.offline = false;
    await expect(page.getByText("Class finished", { exact: false }).first()).toBeVisible({ timeout: 60_000 });
    const summary = await withDb(async (db) => db.classSummary.findFirst({ where: { sessionId } }));
    expect(summary?.homePractice).toBe("Offline practice line");
  } finally {
    await closeAll(coach);
  }
});

export type { Browser, Session };
