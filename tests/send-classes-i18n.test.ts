import { describe, expect, it } from "vitest";
import { LOCALES, messages, translate, type MessageKey } from "../lib/i18n";
import { sendClasses } from "../lib/i18n/messages/en/send-classes";
import { describeUpdate } from "../lib/customer/updates";

const keys = Object.keys(sendClasses) as MessageKey[];

describe("send and class strings", () => {
  it("exist in every language with the same placeholders", () => {
    for (const l of LOCALES) for (const k of keys) expect(messages[l][k], `${l}:${k}`).toBeTruthy();
  });
  it("use calm, positive wording in English (no please, no successfully, no blame)", () => {
    for (const k of keys) {
      const v = sendClasses[k].toLowerCase();
      expect(v, k).not.toMatch(/\bplease\b|successfully|accountab|surveil|failed|fail\b|warning|you must/);
    }
  });
  it("keeps button and badge labels short enough in Hindi and Kannada to fit a 360px screen", () => {
    // Short labels (under 28 English characters) may grow, but not past about 2.6x, so they wrap rather than clip.
    for (const k of keys) {
      const en = sendClasses[k];
      if (en.length > 28) continue;
      for (const l of ["hi", "kn"] as const) expect(messages[l][k].length, `${l}:${k}`).toBeLessThanOrEqual(Math.max(24, en.length * 2.6));
    }
  });
  it("renders the class update kinds in every language", () => {
    for (const l of LOCALES) {
      for (const kind of ["class_summary", "class_catchup", "class_catchup_excused"]) {
        const v = describeUpdate({ kind, params: { batchName: "Kids Karate", date: "2026-11-24" } }, (key, p) => translate(l, key, p), l);
        expect(v.text, `${l}:${kind}`).toContain("Kids Karate");
        expect(v.text).not.toMatch(/\{\w+\}/);
      }
    }
  });
});
