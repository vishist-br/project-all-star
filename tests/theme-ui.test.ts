import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MOCK_TENANTS, resolveTheme } from "../lib/mock-session";
import { themeVars } from "../lib/theme-ui";
import { messages } from "../lib/i18n";

const HEX = /^#[0-9A-Fa-f]{6}$/;

describe("demo tenants and theme", () => {
  it("has three tenants with distinct name, logo and colors, shaped like TenantTheme", () => {
    expect(MOCK_TENANTS).toHaveLength(3);
    for (const k of ["tenantSlug", "displayName", "logoUrl", "primaryColor"] as const) {
      expect(new Set(MOCK_TENANTS.map((t) => t[k])).size).toBe(3);
    }
    for (const t of MOCK_TENANTS) {
      expect(t.primaryColor).toMatch(HEX);
      expect(t.secondaryColor).toMatch(HEX);
      if (t.accentColor) expect(t.accentColor).toMatch(HEX);
      expect(existsSync(join("public", t.logoUrl!))).toBe(true);
    }
  });

  it("maps tenant config to CSS variables", () => {
    const t = MOCK_TENANTS[1];
    expect(themeVars(t)).toEqual({
      "--primary": t.primaryColor,
      "--secondary": t.secondaryColor,
      "--accent": t.accentColor,
    });
    expect(themeVars({ ...t, accentColor: null })["--accent" as never]).toBe(t.primaryColor);
  });

  it("falls back to the first tenant for unknown slugs", () => {
    expect(resolveTheme("nope")).toBe(MOCK_TENANTS[0]);
    expect(resolveTheme(MOCK_TENANTS[2].tenantSlug)).toBe(MOCK_TENANTS[2]);
  });

  it("About Us copy has no tenant placeholders (identical for all tenants)", () => {
    for (const l of Object.values(messages))
      for (const k of ["about.title", "about.p1", "about.p2", "about.p3"] as const)
        expect(l[k]).not.toMatch(/\{\w+\}/);
  });

  it("contains no builder branding in app, components, lib or public files", () => {
    const banned = /all[ _-]?star/i;
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((f) => {
        const p = join(d, f);
        return statSync(p).isDirectory() ? walk(p) : [p];
      });
    const files = ["app", "components", "public"].flatMap(walk).concat(
      walk("lib").filter((f) => !f.endsWith("session.ts")),
    );
    for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(banned);
  });
});
