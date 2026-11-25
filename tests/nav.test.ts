import { describe, expect, it } from "vitest";
import { MAX_BAR_ITEMS, NAV, ROLES, findNavItem, isRole } from "../lib/nav";
import { messages } from "../lib/i18n";

describe("role navigation", () => {
  it("differs per role and fits the mobile bar (4 items plus More)", () => {
    const sigs = ROLES.map((r) => NAV[r].map((i) => i.section).join(","));
    expect(new Set(sigs).size).toBe(3);
    for (const r of ROLES) expect(NAV[r].filter((i) => i.bar).length).toBeLessThanOrEqual(MAX_BAR_ITEMS);
  });
  it("lists every top-level screen of each role, so none is reachable only by a link", () => {
    const has = (r: (typeof ROLES)[number], s: string) => expect(findNavItem(r, s), `${r}/${s}`).toBeDefined();
    for (const s of ["dashboard", "members", "members/import", "batches", "coaches", "insights", "workouts", "holidays", "settings"]) has("owner", s);
    for (const s of ["today", "today/week", "today/availability", "members", "plans", "workouts", "record"]) has("coach", s);
    for (const s of ["home", "workouts", "schedule", "progress", "updates", "absences", "profile"]) has("customer", s);
  });
  it("every label key exists in locale files", () => {
    for (const r of ROLES) for (const i of NAV[r]) expect(messages.en[i.label]).toBeTruthy();
  });
  it("guards roles and sections", () => {
    expect(isRole("admin")).toBe(false);
    expect(findNavItem("customer", "dashboard")).toBeUndefined();
    expect(findNavItem("owner", "dashboard")).toBeDefined();
  });
  it("uses no accountability or surveillance wording", () => {
    for (const l of Object.values(messages))
      for (const v of Object.values(l)) expect(v.toLowerCase()).not.toMatch(/accountab|surveil/);
  });
});
