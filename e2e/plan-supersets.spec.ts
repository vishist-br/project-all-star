import { expect, test, type Page } from "@playwright/test";
import { withDb } from "./helpers/cross-role";

// Plan builder (STAR-108): group exercises as a superset, bracket, move groups, targets by metric type, save.

test.setTimeout(120_000);
test.use({ viewport: { width: 360, height: 780 } });

async function signInCoach(page: Page, request: import("@playwright/test").APIRequestContext) {
  await page.context().clearCookies();
  const res = await request.post("/api/v1/dev/magic-link", { data: { tenantSlug: "demo-gym", email: "c1@demo-gym.example.test" } });
  expect(res.status()).toBe(200);
  const { url } = (await res.json()) as { url: string };
  await page.goto(url);
  await page.waitForURL(/\/coach/, { timeout: 90_000 });
}

async function addExercise(page: Page, search: string, pick: RegExp) {
  const picker = page.getByRole("dialog", { name: "Add exercises" });
  const box = picker.getByLabel("Search exercises");
  await box.fill(search);
  const add = picker.getByRole("button", { name: pick }).first();
  await expect(add).toBeVisible();
  await add.click();
}

test("group two exercises as a superset, edit rounds and rest, reorder, save", async ({ page, request }) => {
  const title = `E2E superset plan ${Date.now()}`;
  await signInCoach(page, request);
  await page.goto("/coach/plans/new");
  await page.getByLabel("Plan name").fill(title);

  await page.getByRole("button", { name: /Add exercises/ }).click();
  const picker = page.getByRole("dialog", { name: "Add exercises" });
  await addExercise(page, "barbell bench press - medium", /^Add Barbell Bench Press - Medium Grip/);
  await addExercise(page, "bent over barbell row", /^Add Bent Over Barbell Row/);
  await addExercise(page, "barbell squat", /^Add Barbell Squat/);
  // The picker shows how each exercise is logged.
  await expect(picker.getByText("Weight and reps").first()).toBeVisible();
  await picker.getByRole("button", { name: "Done" }).click();

  const items = page.getByTestId("plan-item");
  await expect(items).toHaveCount(3);
  await expect(items.first()).toContainText("Tracked as Weight and reps");
  await expect(items.first().getByLabel("Target weight (kg)")).toBeVisible();
  await items.first().getByLabel("Target weight (kg)").fill("40");

  // Tick two, the group button appears with the count; one is not enough.
  await page.getByRole("checkbox", { name: "Select Barbell Bench Press - Medium Grip" }).check();
  await expect(page.getByText("A superset needs at least two exercises.")).toBeVisible();
  await page.getByRole("checkbox", { name: "Select Bent Over Barbell Row" }).check();
  await page.getByRole("button", { name: "Group 2 as superset" }).click();

  const bracket = page.getByRole("region", { name: "Superset A" });
  await expect(bracket).toBeVisible();
  await expect(bracket).toContainText("Superset A, 3 rounds");
  await expect(bracket.getByTestId("plan-item")).toHaveCount(2);
  // Focus lands on the new group's rounds so it can be set right away.
  await expect(bracket.getByLabel("Rounds")).toBeFocused();
  await bracket.getByLabel("Rounds").fill("4");
  await bracket.getByLabel("Shared rest (seconds)").fill("90");
  await expect(bracket).toContainText("Superset A, 4 rounds");

  // Move the whole group down: the squat comes first, the group stays in one piece.
  await bracket.getByRole("button", { name: "Move superset A down" }).click();
  await expect(page.getByTestId("plan-item").first()).toContainText("Barbell Squat");
  await expect(page.getByRole("button", { name: "Move superset A down" })).toBeDisabled();
  // An exercise inside the group moves only inside the group.
  await bracket.getByRole("button", { name: "Move Bent Over Barbell Row up" }).click();
  await expect(bracket.getByTestId("plan-item").first()).toContainText("Bent Over Barbell Row");
  await expect(bracket.getByRole("button", { name: "Move Bent Over Barbell Row up" })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

  await page.getByRole("button", { name: "Save and activate" }).click();
  await expect(page).toHaveURL(/\/coach\/plans$/, { timeout: 30_000 });

  const plan = await withDb((db) =>
    db.workoutPlan.findFirstOrThrow({ where: { title }, include: { days: { include: { items: { orderBy: { position: "asc" }, include: { exercise: true } } } } } }),
  );
  const saved = plan.days[0]!.items.map((i) => [i.exercise.name, i.position, i.supersetGroup, i.rounds, i.sets, i.restSeconds]);
  expect(saved).toEqual([
    ["Barbell Squat", 1, null, null, 3, 60],
    ["Bent Over Barbell Row", 2, "A", 4, 4, 90],
    ["Barbell Bench Press - Medium Grip", 3, "A", 4, 4, 90],
  ]);
  expect(Number(plan.days[0]!.items[2]!.targetWeightKg)).toBe(40);

  // Reopen: the saved superset is bracketed, and ungrouping puts the exercises back as singles.
  await page.goto(`/coach/plans/${plan.id}`);
  const again = page.getByRole("region", { name: "Superset A" });
  await expect(again).toContainText("Superset A, 4 rounds");
  await again.getByRole("button", { name: "Ungroup superset A" }).click();
  await expect(page.getByRole("region", { name: "Superset A" })).toHaveCount(0);
  await expect(page.getByTestId("plan-item")).toHaveCount(3);
});

test("the exercise picker starts on the plan's sport and shows metric types", async ({ page, request }) => {
  await signInCoach(page, request);
  await page.goto("/coach/plans/new");
  await page.getByLabel("Sport").selectOption("swimming");
  await page.getByRole("button", { name: /Add exercises/ }).click();
  const picker = page.getByRole("dialog", { name: "Add exercises" });
  await expect(picker.getByText("Showing swimming exercises first.")).toBeVisible();
  await expect(picker.getByText("Distance and time").first()).toBeVisible();
  await picker.getByRole("button", { name: /^Add Freestyle laps/ }).first().click();
  await picker.getByRole("button", { name: "Done" }).click();
  const item = page.getByTestId("plan-item").first();
  await expect(item).toContainText("Tracked as Distance and time");
  await expect(item.getByLabel("Target distance (m)")).toHaveValue("50");
});
