import { describe, expect, it } from "vitest";
import { slugify } from "../lib/slug";

describe("slugify", () => {
  it("makes url-safe slugs", () => {
    expect(slugify("  Iron Tiger Karate Academy! ")).toBe("iron-tiger-karate-academy");
  });
});
