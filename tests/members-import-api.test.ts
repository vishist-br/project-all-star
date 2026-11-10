import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { authorizeWith, checkRole } from "../lib/auth/guard";
import { ApiError } from "../lib/auth/errors";
import type { Principal } from "../lib/auth/principal";
import { assertCsvUpload, importMembers } from "../lib/import/server";
import { tryConnect } from "./helpers-db";

const HEADER = "name,phone,email,guardian_name,guardian_phone,batch_name,sport,level,goal,join_date,fee_status";
const SAMPLE = readFileSync("public/sample-members.csv", "utf8");

describe("owner-only guard (no database)", () => {
  const p = (role: Principal["role"]): Principal => ({ tenantId: "t", userId: "u", role });
  it("rejects coach, customer and anonymous", () => {
    expect(() => checkRole(p("coach"), "importMembersCsv")).toThrow(ApiError);
    expect(() => checkRole(p("customer"), "importMembersCsv")).toThrow(ApiError);
    expect(() => checkRole(null, "importMembersCsv")).toThrow(ApiError);
    expect(checkRole(p("owner"), "importMembersCsv")?.role).toBe("owner");
  });
  it("explicitly rejects Excel and PDF uploads", () => {
    const text = "PK\u0003\u0004binary";
    expect(() => assertCsvUpload(new File([text], "members.xlsx"), text)).toThrow(/not supported/);
    expect(() => assertCsvUpload(new File(["%PDF-1.4"], "m.pdf"), "%PDF-1.4")).toThrow(/not supported/);
    expect(() => assertCsvUpload(new File(["name\nA"], "members.csv"), "name\nA")).not.toThrow();
  });
  it("rejects files over 2 MB", () => {
    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], "m.csv");
    expect(() => assertCsvUpload(big, "")).toThrow(/larger than 2 MB/);
  });
});

describe("POST /members/import logic (local Postgres)", () => {
  let prisma: PrismaClient | null = null;
  const sfx = Date.now().toString(36);
  let a = "";
  let b = "";
  const scoped = async (tenantId: string) =>
    authorizeWith({ tenantId, userId: "owner", role: "owner" }, "importMembersCsv", prisma!).db;

  beforeAll(async () => {
    prisma = await tryConnect();
    if (!prisma) return;
    a = (await prisma.tenant.create({ data: { slug: `imp-a-${sfx}`, name: "Import A" } })).id;
    b = (await prisma.tenant.create({ data: { slug: `imp-b-${sfx}`, name: "Import B" } })).id;
    const sport = await prisma.sport.create({ data: { tenantId: a, slug: "karate", name: "Karate" } });
    await prisma.level.create({ data: { tenantId: a, sportId: sport.id, name: "White belt", rank: 1 } });
  });
  afterAll(async () => {
    if (!prisma) return;
    await prisma.tenant.deleteMany({ where: { id: { in: [a, b] } } });
    await prisma.$disconnect();
  });

  it("dry run saves nothing", async () => {
    if (!prisma) return;
    const r = await importMembers(await scoped(a), a, SAMPLE, true);
    expect(r.errors).toEqual([]);
    expect(r.totalRows).toBe(3);
    expect(r.importedRows).toBeUndefined();
    expect(await prisma.member.count({ where: { tenantId: a } })).toBe(0);
  });

  it("imports the sample into the caller's tenant only, and re-import creates no duplicates", async () => {
    if (!prisma) return;
    const r = await importMembers(await scoped(a), a, SAMPLE, false);
    expect(r.errors).toEqual([]);
    expect(r.importedRows).toBe(3);
    expect(await prisma.member.count({ where: { tenantId: a } })).toBe(3);
    expect(await prisma.member.count({ where: { tenantId: b } })).toBe(0);
    const kid = await prisma.member.findFirst({ where: { tenantId: a, displayName: "Sample Child Two" }, include: { guardian: true } });
    expect(kid?.isMinor).toBe(true);
    expect(kid?.phone).toBeNull();
    expect(kid?.guardian?.tenantId).toBe(a);
    // Karate / White belt exist in tenant A, so the level is recorded; unknown batches only warn.
    expect(r.warnings.some((w) => w.column === "batch_name")).toBe(true);
    expect(await prisma.memberLevel.count({ where: { tenantId: a } })).toBe(1);

    const again = await importMembers(await scoped(a), a, SAMPLE, false);
    expect(again.errors).toEqual([]);
    expect(again.importedRows).toBe(0);
    expect(again.skippedRows).toBe(3);
    expect(await prisma.member.count({ where: { tenantId: a } })).toBe(3);
  });

  it("wrong tenant: the same file imports into tenant B independently and never touches A", async () => {
    if (!prisma) return;
    const r = await importMembers(await scoped(b), b, SAMPLE, false);
    expect(r.importedRows).toBe(3);
    expect(r.skippedRows).toBe(0);
    expect(await prisma.member.count({ where: { tenantId: a } })).toBe(3);
    expect(await prisma.member.count({ where: { tenantId: b } })).toBe(3);
    expect(await prisma.guardian.count({ where: { tenantId: b } })).toBe(1);
  });

  it("malformed rows are reported with row number and reason, and nothing is saved (all or nothing)", async () => {
    if (!prisma) return;
    const csv = `${HEADER}\nGood Person,+919000000050,,,,,,,,2026-01-01,paid\n,,,,,,,,,2026-13-40,paid\nBad Phone,12,,,,,,,,,maybe`;
    const r = await importMembers(await scoped(a), a, csv, false);
    expect(r.importedRows).toBeUndefined();
    expect(r.errors).toEqual([
      { row: 2, column: "name", message: expect.any(String) },
      { row: 2, column: "join_date", message: expect.any(String) },
      { row: 3, column: "phone", message: expect.any(String) },
      { row: 3, column: "fee_status", message: expect.any(String) },
    ]);
    expect(r.validRows).toBe(1);
    expect(await prisma.member.count({ where: { tenantId: a, displayName: "Good Person" } })).toBe(0);
  });

  it("duplicate rows inside one file are errors", async () => {
    if (!prisma) return;
    const csv = `name,phone\nDup Person,+919000000060\ndup  person,+91 90000 00060`;
    const r = await importMembers(await scoped(a), a, csv, false);
    expect(r.errors).toEqual([{ row: 2, column: "name", message: "Duplicate of row 1 in this file." }]);
    expect(await prisma.member.count({ where: { tenantId: a, displayName: "Dup Person" } })).toBe(0);
  });

  it("only name is required; whole-file problems throw", async () => {
    if (!prisma) return;
    const ok = await importMembers(await scoped(a), a, "name\nName Only Person", false);
    expect(ok.errors).toEqual([]);
    expect(ok.importedRows).toBe(1);
    await expect(importMembers(await scoped(a), a, "", true)).rejects.toThrow(ApiError);
    await expect(importMembers(await scoped(a), a, "phone\n+919000000001", true)).rejects.toThrow(/name/);
  });
});
