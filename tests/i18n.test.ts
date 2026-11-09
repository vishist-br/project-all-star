import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LOCALES, NEEDS_REVIEW, messages, translate } from "../lib/i18n";

const base = Object.keys(messages.en).sort();
const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");

describe("i18n locale files", () => {
  for (const locale of LOCALES) {
    it(`${locale} has exactly the same keys as en (no missing, no extra)`, () => {
      expect(Object.keys(messages[locale]).sort()).toEqual(base);
    });
    it(`${locale} has no empty strings and matching placeholders`, () => {
      for (const key of base) {
        const v = (messages[locale] as Record<string, string>)[key];
        expect(v?.trim(), `${locale}:${key}`).toBeTruthy();
        expect(placeholders(v), `${locale}:${key}`).toBe(
          placeholders((messages.en as Record<string, string>)[key]),
        );
      }
    });
  }

  it("hi and kn files carry the needs-review marker (file header and visible string)", () => {
    for (const locale of NEEDS_REVIEW) {
      const src = readFileSync(new URL(`../lib/i18n/messages/${locale}.ts`, import.meta.url), "utf8");
      expect(src).toContain("needs native-speaker review");
      expect(messages[locale]["review.marker"]).toContain("needs native-speaker review");
      expect(messages[locale]["review.banner"]).toContain("needs native-speaker review");
    }
  });

  it("interpolates params", () => {
    expect(translate("en", "home.title", { business: "Demo" })).toBe("Welcome to Demo");
  });
});
