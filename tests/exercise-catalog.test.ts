import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import { tryConnect } from "./helpers-db";
import { importCatalog, loadGymEntries, loadOriginalEntries } from "../prisma/catalog/import";

describe("exercise catalog data", () => {
  it("gym entries come from the pinned free-exercise-db commit with no images", () => {
    const gym = loadGymEntries();
    expect(gym.length).toBeGreaterThan(800);
    expect(new Set(gym.map((g) => g.sourceId)).size).toBe(gym.length);
    expect(gym.every((g) => g.licence === "Unlicense" && /^[0-9a-f]{40}$/.test(g.sourceCommit ?? ""))).toBe(true);
    expect(readFileSync("data/free-exercise-db/exercises.json", "utf8")).not.toMatch(/"images"/);
  });

  it("original drafts are flagged for trainer review", () => {
    for (const e of loadOriginalEntries()) {
      expect(e.needsTrainerReview).toBe(true);
      expect(e.source).toBe("ORIGINAL");
    }
  });

  it("documents the pinned commit and licence", () => {
    const doc = readFileSync("docs/THIRD_PARTY.md", "utf8");
    const { sourceCommit } = loadGymEntries()[0];
    expect(doc).toContain(sourceCommit!);
    expect(doc).toContain("Unlicense");
  });
});

describe("exercise import (local Postgres)", () => {
  let prisma: PrismaClient | null = null;
  let tenantId = "";
  beforeAll(async () => {
    prisma = await tryConnect();
    if (!prisma) return;
    tenantId = (await prisma.tenant.create({ data: { slug: `cat-${Date.now().toString(36)}`, name: "Catalog test" } })).id;
  });
  afterAll(async () => {
    if (!prisma) return;
    await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.$disconnect();
  });

  it("is re-runnable without duplicates and keeps trainer review state", async (ctx) => {
    if (!prisma) return ctx.skip();
    const first = await importCatalog(prisma, tenantId);
    const count = await prisma.exercise.count({ where: { tenantId } });
    expect(count).toBe(first.total);

    const one = await prisma.exercise.findFirstOrThrow({ where: { tenantId } });
    await prisma.exercise.update({ where: { id: one.id }, data: { needsTrainerReview: !one.needsTrainerReview } });
    await importCatalog(prisma, tenantId);
    expect(await prisma.exercise.count({ where: { tenantId } })).toBe(count);
    const after = await prisma.exercise.findUniqueOrThrow({ where: { id: one.id } });
    expect(after.needsTrainerReview).toBe(!one.needsTrainerReview);
  });
});
