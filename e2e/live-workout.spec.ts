import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { seedLivePlan } from "./helpers/live-fixture";
import { withDb } from "./helpers/cross-role";

// Live workout (STAR-108): a superset round, the rest timer, finish, and offline then online sync.
// Two demo-gym members get their own seeded plan so the tests never share logged sets.

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);
test.use({ viewport: { width: 360, height: 780 } });

const A = { email: "member-m11@demo-gym.example.test", name: "Sample Member 11" };
const B = { email: "member-m12@demo-gym.example.test", name: "Sample Member 12" };
const BENCH = "Barbell Bench Press - Medium Grip";
const ROW = "Bent Over Barbell Row";

async function signIn(page: Page, request: APIRequestContext, email: string) {
  await page.context().clearCookies();
  const res = await request.post("/api/v1/dev/magic-link", { data: { tenantSlug: "demo-gym", email } });
  expect(res.status()).toBe(200);
  const { url } = (await res.json()) as { url: string };
  await page.goto(url);
  await page.waitForURL(/\/customer\/home$/, { timeout: 90_000 });
}

const tick = (page: Page, set: number, name: string) => page.getByRole("button", { name: `Mark set ${set} done, ${name}` });
const noSideScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

test.beforeAll(async () => {
  await withDb(async (db) => {
    await seedLivePlan(db, { memberName: A.name, planTitle: "E2E live circuit A" });
    await seedLivePlan(db, { memberName: B.name, planTitle: "E2E live circuit B" });
  });
});

test("log a superset round, rest timer, finish and summary", async ({ page, request }) => {
  await signIn(page, request, A.email);
  await page.goto("/customer/workouts");
  await page.getByRole("link", { name: "Start live workout" }).click();
  await expect(page).toHaveURL(/\/customer\/workouts\/live$/);
  await expect(page.getByRole("heading", { level: 1, name: "Live workout" })).toBeVisible();

  // The superset card: tag, rounds and the shared rest; progress starts at zero.
  const superset = page.getByRole("region", { name: "Superset A" });
  await expect(superset).toContainText("Superset A");
  await expect(superset).toContainText("3 rounds");
  await expect(superset).toContainText("Rest 1 min after both");
  await expect(page.getByTestId("sets-progress")).toHaveText("0 of 12 sets done");
  await expect(page.getByText("Round 1 of 3")).toBeVisible();
  await noSideScroll(page);

  // Plan targets are pre-filled; changing a value works with the numeric keypad inputs.
  const benchKg = page.getByRole("textbox", { name: `kg, set 1, ${BENCH}` });
  await expect(benchKg).toHaveValue("40");
  expect(await benchKg.getAttribute("inputmode")).toBe("decimal");
  await benchKg.fill("42.5");

  // Ticking the first exercise moves focus to the next exercise of the group; no rest yet.
  await tick(page, 1, BENCH).click();
  await expect(page.getByRole("textbox", { name: `kg, set 1, ${ROW}` })).toBeFocused();
  await expect(page.getByTestId("rest-timer")).toHaveCount(0);
  await expect(page.getByTestId("sets-progress")).toHaveText("1 of 12 sets done");

  // Ticking the second finishes the round: one rest timer starts, with skip and +15 s.
  await tick(page, 1, ROW).click();
  const timer = page.getByTestId("rest-timer");
  await expect(timer).toBeVisible();
  await expect(timer.getByTestId("rest-time")).toHaveText(/^(1:00|0:5\d)$/);
  await timer.getByRole("button", { name: "Add 15 seconds to the rest" }).click();
  await expect(timer.getByTestId("rest-time")).toHaveText(/^1:(0\d|1\d)$/);
  await expect(page.getByText("Round 2 of 3")).toBeVisible();
  await timer.getByRole("button", { name: "Skip rest" }).click();
  await expect(page.getByTestId("rest-timer")).toHaveCount(0);
  await expect(page.getByTestId("sync-chip")).toHaveText("All saved");

  // An empty required value is refused with a message and focus goes to the field.
  const reps = page.getByRole("textbox", { name: `Reps, set 1, Barbell Squat` });
  await reps.fill("");
  await tick(page, 1, "Barbell Squat").click();
  await expect(page.getByText("Add a value to log this set.")).toBeVisible();
  await expect(reps).toBeFocused();
  await reps.fill("5");
  await tick(page, 1, "Barbell Squat").click();
  await expect(page.getByTestId("sets-progress")).toHaveText("3 of 12 sets done");

  // Finish asks first; the summary shows totals, a new best only when the engine reports one.
  await page.getByRole("button", { name: "Finish workout" }).click();
  const dialog = page.getByRole("dialog", { name: "Finish this workout?" });
  await expect(dialog).toContainText("3 of 12 sets are logged");
  await dialog.locator(".btn", { hasText: "Keep going" }).click();
  await page.getByRole("button", { name: "Finish workout" }).click();
  await dialog.locator(".btn", { hasText: "Finish workout" }).click();
  await expect(page.getByTestId("finish-summary")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Workout finished" })).toBeFocused();
  await expect(page.getByTestId("finish-summary")).toContainText("Sets");
  await expect(page.getByTestId("finish-summary")).toContainText("3");
  await expect(page.getByText(/No new bests this time|New best/)).toBeVisible();

  // Saved on the server: three sets with the ticked values, bench weight 42.5 as typed. Finishing marks each
  // exercise complete through the same queue as the sets, so poll the server.
  const readRows = () =>
    withDb((db) =>
      db.workoutSet.findMany({ where: { log: { member: { displayName: A.name } } }, include: { log: { include: { planItem: { include: { exercise: true } } } } }, orderBy: { setNumber: "asc" } }),
    );
  await expect.poll(async () => (await readRows()).every((r) => r.log.status === "COMPLETED"), { timeout: 30_000 }).toBe(true);
  const rows = await readRows();
  expect(rows).toHaveLength(3);
  const bench = rows.find((r) => r.log.planItem.exercise.name === BENCH)!;
  expect(Number(bench.weightKg)).toBe(42.5);
  expect(bench.log.status).toBe("COMPLETED");
  expect(rows.every((r) => r.clientId.startsWith("ws-"))).toBe(true);

  // Back to the list: the old item flow still shows the exercises.
  await page.getByRole("link", { name: "Back to workouts" }).click();
  await expect(page).toHaveURL(/\/customer\/workouts$/);
});

test("offline: sets are saved on the phone and sync when back online", async ({ page, request, context }) => {
  await signIn(page, request, B.email);
  await page.goto("/customer/workouts/live");
  await expect(page.getByTestId("sets-progress")).toHaveText("0 of 12 sets done");

  await context.setOffline(true);
  await tick(page, 1, "Barbell Squat").click();
  await tick(page, 2, "Barbell Squat").click();
  await expect(page.getByTestId("sets-progress")).toHaveText("2 of 12 sets done");
  await expect(page.getByTestId("sync-chip")).toHaveText("Offline, saved on this phone");
  const queued = await page.evaluate(() => JSON.parse(localStorage.getItem("workoutQueue.v1") ?? "[]") as { kind?: string; sets: { clientId: string }[] }[]);
  expect(queued.length).toBe(2);
  expect(queued.every((q) => q.kind === "sets" && q.sets[0]!.clientId.startsWith("ws-"))).toBe(true);
  expect(await withDb((db) => db.workoutSet.count({ where: { log: { member: { displayName: B.name } } } }))).toBe(0);

  // A reload while offline cannot reach the server, so check the queue after coming back online instead.
  await context.setOffline(false);
  await expect(page.getByTestId("sync-chip")).toHaveText("All saved");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("workoutQueue.v1"))).toBeNull();
  const rows = await withDb((db) => db.workoutSet.findMany({ where: { log: { member: { displayName: B.name } } } }));
  expect(rows).toHaveLength(2);

  // Replaying the same queued sets again changes nothing (same set ids).
  await page.reload();
  await expect(page.getByTestId("sets-progress")).toHaveText("2 of 12 sets done");
  expect(await withDb((db) => db.workoutSet.count({ where: { log: { member: { displayName: B.name } } } }))).toBe(2);
});
