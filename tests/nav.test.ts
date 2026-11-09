import { describe, expect, it } from "vitest";
import { NAV, ROLES, findNavItem, isRole } from "../lib/nav";
import { messages } from "../lib/i18n";

describe("role navigation", () => {
  it("differs per role and fits a 5-item mobile bar", () => {
    const sigs = ROLES.map((r) => NAV[r].map((i) => i.section).join(","));
    expect(new Set(sigs).size).toBe(3);
    for (const r of ROLES) expect(NAV[r].length).toBeLessThanOrEqual(5);
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
