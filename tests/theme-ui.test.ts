import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEMO_TENANT_SLUGS } from "../lib/demo";
import { NEUTRAL_THEME, themeVars } from "../lib/theme-ui";
import { messages } from "../lib/i18n";

const SEED = readFileSync("prisma/seed/data.ts", "utf8");

describe("demo tenants and theme", () => {
  it("demo tenant slugs are exactly the seeded tenants, and their logos exist in public/", () => {
    expect([...DEMO_TENANT_SLUGS]).toEqual(["demo-karate", "demo-gym", "demo-studio"]);
    for (const slug of DEMO_TENANT_SLUGS) {
      expect(SEED).toContain(`slug: "${slug}"`);
      expect(existsSync(join("public", "tenants", `${slug}.svg`))).toBe(true);
    }
  });

  it("no mock tenant data is left in the UI code", () => {
    expect(existsSync("lib/mock-session.ts")).toBe(false);
    expect(existsSync("public/demo-logos")).toBe(false);
  });

  it("maps tenant config to CSS variables", () => {
    const t = { ...NEUTRAL_THEME, primaryColor: "#B3202A", secondaryColor: "#1A1A1A", accentColor: "#F2C94C" };
    expect(themeVars(t)).toEqual({ "--primary": "#B3202A", "--secondary": "#1A1A1A", "--accent": "#F2C94C" });
    expect(themeVars({ ...t, accentColor: null })["--accent" as never]).toBe("#B3202A");
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
