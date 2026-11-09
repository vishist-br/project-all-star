import { describe, expect, it } from "vitest";
import { canViewRole, homePath } from "../lib/guard";
import { ROLES } from "../lib/nav";
import { messages, LOCALES } from "../lib/i18n";

describe("role route guard", () => {
  it("allows only the user's own role", () => {
    for (const s of ROLES) for (const r of ROLES) expect(canViewRole(s, r)).toBe(s === r);
  });
  it("home path is the role root", () => {
    expect(homePath("coach")).toBe("/coach");
  });
});

describe("role home placeholders", () => {
  it("have title, body and three items in every locale", () => {
    for (const l of LOCALES)
      for (const r of ROLES)
        for (const k of ["title", "body", "item1", "item2", "item3"])
          expect((messages[l] as Record<string, string>)[`home.${r}.${k}`], `${l}.${r}.${k}`).toBeTruthy();
  });
  it("English bodies use the word visibility", () => {
    for (const r of ROLES) expect((messages.en as Record<string, string>)[`home.${r}.body`]).toMatch(/visibility/i);
  });
  it("has not-allowed strings in every locale", () => {
    for (const l of LOCALES) expect(messages[l]["notAllowed.title"]).toBeTruthy();
  });
});
