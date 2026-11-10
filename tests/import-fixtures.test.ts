/**
 * CSV and catalog import tests driven by fake fixture files in tests/fixtures (STAR-41).
 * Adds counts and exact messages for valid, malformed, duplicate and wrong-tenant CSVs, and
 * a re-run test for the exercise catalog import. All data is invented.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { authorizeWith } from "../lib/auth/guard";
import { importMembers } from "../lib/import/server";
import { importCatalog, loadGymEntries, loadOriginalEntries } from "../prisma/catalog/import";
import { tryConnect } from "./helpers-db";

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");

describe("CSV fixtures (local Postgres)", () => {
  let prisma: PrismaClient | null = null;
  const sfx = Date.now().toString(36);
  let a = "";
  let b = "";
  let batchB = "";
  const scoped = (tenantId: string) => authorizeWith({ tenantId, userId: "owner", role: "owner" }, "importMembersCsv", prisma!).db;
  const count = (tenantId: string) => prisma!.member.count({ where: { tenantId } });
  const fresh = async (slug: string) => (await prisma!.tenant.create({ data: { slug: `${slug}-${sfx}`, name: slug } })).id;

  beforeAll(async () => {
    prisma = await tryConnect();
    if (!prisma) return;
    a = await fresh("fx-a");
    b = await fresh("fx-b");
    // Tenant B alone owns a venue, coach, sport, level and batch that wrong-tenant.csv refers to.
    const venue = await prisma.venue.create({ data: { tenantId: b, name: "Fixture Venue" } });
    const coach = await prisma.user.create({ data: { tenantId: b, role: "COACH", email: "fx-coach@example.test", name: "Fixture Coach" } });
    const sport = await prisma.sport.create({ data: { tenantId: b, slug: "fixture-sport-b", name: "Fixture Sport B" } });
    await prisma.level.create({ data: { tenantId: b, sportId: sport.id, name: "Fixture Level B", rank: 1 } });
    batchB = (
      await prisma.batch.create({
        data: { tenantId: b, coachId: coach.id, venueId: venue.id, sportId: sport.id, name: "Fixture Only In B", daysOfWeek: [1], startTime: "18:00", endTime: "19:00" },
      })
    ).id;
  });
  afterAll(async () => {
    if (!prisma) return;
    await prisma.tenant.deleteMany({ where: { id: { in: [a, b] } } });
    await prisma.$disconnect();
  });

  it("valid.csv: dry run reports 4 valid rows and saves nothing", async (ctx) => {
    if (!prisma) return ctx.skip();
    const r = await importMembers(scoped(a), a, fixture("valid.csv"), true);
    expect(r).toMatchObject({ dryRun: true, totalRows: 4, validRows: 4, errors: [], warnings: [], skippedRows: 0 });
    expect(r.importedRows).toBeUndefined();
    expect(r.preview).toHaveLength(4);
    expect(await count(a)).toBe(0);
  });

  it("valid.csv: import saves 4 members (one child with a guardian) and a re-run saves none", async (ctx) => {
    if (!prisma) return ctx.skip();
    const r = await importMembers(scoped(a), a, fixture("valid.csv"), false);
    expect(r).toMatchObject({ importedRows: 4, totalRows: 4, validRows: 4, errors: [], skippedRows: 0 });
    expect(await count(a)).toBe(4);
    const kid = await prisma.member.findFirstOrThrow({ where: { tenantId: a, displayName: "Fixture Kid Two" }, include: { guardian: true } });
    expect(kid).toMatchObject({ isMinor: true, phone: null, feeStatus: "DUE" });
    expect(kid.guardian).toMatchObject({ name: "Fixture Guardian Two", phone: "+919000001002" });
    expect(await prisma.member.count({ where: { tenantId: a, feeStatus: "OVERDUE" } })).toBe(1);
    expect(await prisma.guardian.count({ where: { tenantId: a } })).toBe(1);

    const again = await importMembers(scoped(a), a, fixture("valid.csv"), false);
    expect(again).toMatchObject({ importedRows: 0, skippedRows: 4, errors: [] });
    expect(await count(a)).toBe(4);
    expect(await prisma.guardian.count({ where: { tenantId: a } })).toBe(1);
  });

  it("malformed.csv: exact row errors, 1 valid of 8 rows, nothing saved", async (ctx) => {
    if (!prisma) return ctx.skip();
    const before = await count(a);
    const r = await importMembers(scoped(a), a, fixture("malformed.csv"), false);
    expect(r.errors).toEqual([
      { row: 2, column: "name", message: "Name is required." },
      { row: 3, column: "join_date", message: "Use the date format YYYY-MM-DD." },
      { row: 4, column: "phone", message: "Phone number looks invalid." },
      { row: 5, column: "email", message: "Email looks invalid." },
      { row: 6, column: "fee_status", message: "Use paid, due or overdue." },
      { row: 7, column: "guardian_name", message: "Guardian name is required when a guardian phone is given." },
      { row: 8, column: "phone", message: "A child's phone is not stored; use guardian_phone for children." },
    ]);
    expect(r).toMatchObject({ totalRows: 8, validRows: 1 });
    expect(r.importedRows).toBeUndefined();
    expect(await count(a)).toBe(before); // all or nothing: even the good row is not saved
    expect(await prisma.member.count({ where: { tenantId: a, displayName: "Fixture Good Row" } })).toBe(0);
  });

  it("duplicate.csv: the repeat row is an error naming the first row; nothing saved", async (ctx) => {
    if (!prisma) return ctx.skip();
    const before = await count(a);
    const r = await importMembers(scoped(a), a, fixture("duplicate.csv"), false);
    expect(r.errors).toEqual([{ row: 3, column: "name", message: "Duplicate of row 1 in this file." }]);
    expect(r).toMatchObject({ totalRows: 3, validRows: 2, skippedRows: 0 });
    expect(await count(a)).toBe(before);
  });

  it("wrong-tenant.csv: names that exist only in tenant B are not linked in tenant A (warnings, no cross-tenant link)", async (ctx) => {
    if (!prisma) return ctx.skip();
    const r = await importMembers(scoped(a), a, fixture("wrong-tenant.csv"), false);
    expect(r.errors).toEqual([]);
    expect(r.importedRows).toBe(2);
    expect(r.warnings).toEqual([
      { row: 1, column: "batch_name", message: "No batch with this name; member was not enrolled." },
      { row: 1, column: "sport", message: "No sport with this name; sport was not linked." },
      { row: 1, column: "level", message: "Level needs a known sport; level was not recorded." },
      { row: 2, column: "batch_name", message: "No batch with this name; member was not enrolled." },
    ]);
    expect(await prisma.batchMember.count({ where: { batchId: batchB } })).toBe(0);
    expect(await prisma.memberLevel.count({ where: { tenantId: a } })).toBe(0);
    expect(await count(b)).toBe(0);
  });

  it("wrong-tenant.csv: the same file imported as tenant B links B's batch and level, and tenant A is untouched", async (ctx) => {
    if (!prisma) return ctx.skip();
    const aBefore = await count(a);
    const r = await importMembers(scoped(b), b, fixture("wrong-tenant.csv"), false);
    expect(r).toMatchObject({ errors: [], warnings: [], importedRows: 2, skippedRows: 0 });
    expect(await prisma.batchMember.count({ where: { batchId: batchB } })).toBe(2);
    expect(await prisma.memberLevel.count({ where: { tenantId: b } })).toBe(1);
    expect(await count(b)).toBe(2);
    expect(await count(a)).toBe(aBefore);
  });

  it("whole-file problems are rejected with a clear message", async (ctx) => {
    if (!prisma) return ctx.skip();
    await expect(importMembers(scoped(a), a, fixture("empty.csv"), true)).rejects.toThrow("The file is empty.");
    await expect(importMembers(scoped(a), a, fixture("missing-name-column.csv"), true)).rejects.toThrow('Missing required column "name".');
  });

  it("unknown-column.csv: imports, with a warning that the column was ignored", async (ctx) => {
    if (!prisma) return ctx.skip();
    const r = await importMembers(scoped(a), a, fixture("unknown-column.csv"), false);
    expect(r.errors).toEqual([]);
    expect(r.importedRows).toBe(1);
    expect(r.warnings).toEqual([{ row: 0, column: "nickname", message: 'Column "nickname" is not recognised and was ignored.' }]);
  });
});

describe("catalog import re-run with fixture data (local Postgres)", () => {
  let prisma: PrismaClient | null = null;
  const sfx = Date.now().toString(36);
  let a = "";
  let b = "";
  const entries = () => [
    ...loadGymEntries(join(__dirname, "fixtures/catalog-gym.json")),
    ...loadOriginalEntries(join(__dirname, "fixtures/catalog-original.json")),
  ];

  beforeAll(async () => {
    prisma = await tryConnect();
    if (!prisma) return;
    a = (await prisma.tenant.create({ data: { slug: `fx-cat-a-${sfx}`, name: "Catalog A" } })).id;
    b = (await prisma.tenant.create({ data: { slug: `fx-cat-b-${sfx}`, name: "Catalog B" } })).id;
  });
  afterAll(async () => {
    if (!prisma) return;
    await prisma.tenant.deleteMany({ where: { id: { in: [a, b] } } });
    await prisma.$disconnect();
  });

  it("fixture entries load as expected: 3 gym (Unlicense) and 2 original drafts needing review", () => {
    const e = entries();
    expect(e).toHaveLength(5);
    expect(e.filter((x) => x.source === "FREE_EXERCISE_DB")).toHaveLength(3);
    expect(e.filter((x) => x.needsTrainerReview).map((x) => x.sportSlug).sort()).toEqual(["karate", "yoga"]);
  });

  it("running the import three times leaves exactly 5 rows, with no duplicates", async (ctx) => {
    if (!prisma) return ctx.skip();
    for (let i = 0; i < 3; i++) expect(await importCatalog(prisma, a, entries())).toEqual({ total: 5 });
    expect(await prisma.exercise.count({ where: { tenantId: a } })).toBe(5);
    const keys = (await prisma.exercise.findMany({ where: { tenantId: a }, select: { source: true, sourceId: true } })).map((x) => `${x.source}/${x.sourceId}`);
    expect(new Set(keys).size).toBe(5);
  });

  it("a re-run refreshes changed content in place (same row id) and keeps trainer-review state", async (ctx) => {
    if (!prisma) return ctx.skip();
    const before = await prisma.exercise.findFirstOrThrow({ where: { tenantId: a, sourceId: "fixture-karate-stance" } });
    await prisma.exercise.update({ where: { id: before.id }, data: { needsTrainerReview: false } });
    const changed = entries().map((e) => (e.sourceId === "fixture-karate-stance" ? { ...e, name: "Fixture front stance (edited)" } : e));
    await importCatalog(prisma, a, changed);
    const after = await prisma.exercise.findFirstOrThrow({ where: { tenantId: a, sourceId: "fixture-karate-stance" } });
    expect(after.id).toBe(before.id);
    expect(after.name).toBe("Fixture front stance (edited)");
    expect(after.needsTrainerReview).toBe(false);
    expect(await prisma.exercise.count({ where: { tenantId: a } })).toBe(5);
  });

  it("each tenant gets its own copy: importing into B adds 5 rows to B and none to A", async (ctx) => {
    if (!prisma) return ctx.skip();
    await importCatalog(prisma, b, entries());
    await importCatalog(prisma, b, entries());
    expect(await prisma.exercise.count({ where: { tenantId: b } })).toBe(5);
    expect(await prisma.exercise.count({ where: { tenantId: a } })).toBe(5);
    const aIds = new Set((await prisma.exercise.findMany({ where: { tenantId: a }, select: { id: true } })).map((x) => x.id));
    const bRows = await prisma.exercise.findMany({ where: { tenantId: b }, select: { id: true } });
    expect(bRows.some((x) => aIds.has(x.id))).toBe(false);
  });
});
