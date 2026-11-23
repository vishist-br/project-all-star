import { describe, expect, it } from "vitest";
import { messages } from "../lib/i18n";
import { NAV } from "../lib/nav";

describe("customer navigation (STAR-69)", () => {
  it("lists Home, Workouts, Schedule, Progress, Updates, Plan an absence and Profile, with labels in every language", () => {
    expect(NAV.customer.map((i) => i.section)).toEqual(["home", "workouts", "schedule", "progress", "updates", "absences", "profile"]);
    for (const l of ["en", "hi", "kn"] as const) for (const i of NAV.customer) expect(messages[l][i.label]).toBeTruthy();
  });
});
