import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Every model except Tenant must have a required tenantId mapped to tenant_id,
// and at least one index/unique starting with tenantId.
describe("schema tenancy rule", () => {
  const src = readFileSync("prisma/schema.prisma", "utf8");
  const models = [...src.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map((m) => ({
    name: m[1],
    body: m[2],
  }));

  it("finds models", () => expect(models.length).toBeGreaterThan(1));

  for (const m of models.filter((m) => m.name !== "Tenant")) {
    it(`${m.name} has non-null tenantId and a tenant-first index`, () => {
      expect(m.body).toMatch(/^\s*tenantId\s+String\s+@map\("tenant_id"\)/m);
      expect(m.body).toMatch(/@@(index|unique)\(\[tenantId\b/);
    });
  }
});
