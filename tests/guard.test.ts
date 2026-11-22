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

describe("role home", () => {
  it("has no placeholder or home-card strings left in any locale", () => {
    for (const l of LOCALES)
      for (const k of Object.keys(messages[l])) expect(k, `${l}.${k}`).not.toMatch(/^shell\.placeholder$|^home\.(owner|coach|customer)\./);
  });
  it("has not-allowed strings in every locale", () => {
    for (const l of LOCALES) expect(messages[l]["notAllowed.title"]).toBeTruthy();
  });
});
