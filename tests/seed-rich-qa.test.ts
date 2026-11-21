/**
 * STAR-74: rich seed (prisma/seed/rich*.ts) checks that complement tests/seed.test.ts and
 * tests/privacy.test.ts: static privacy of the rich files, a full idempotency snapshot, and an
 * N+1 guard on the owner analytics endpoints running against the rich demo tenants.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { tryConnect } from "./helpers-db";
import { seedDemo } from "../prisma/seed/demo";
import { RICH } from "../prisma/seed/rich-data";
import { forTenant } from "../lib/tenant-scope";
import { getCoachWorkload, getFeeStats, getOwnerInsights, getOwnerOverview, getOwnerTrends } from "../lib/api/analytics";
import { listCoaches } from "../lib/api/coaches";

/* eslint-disable @typescript-eslint/no-explicit-any */
const root = new URL("..", import.meta.url).pathname;
const RICH_FILES = ["prisma/seed/rich.ts", "prisma/seed/rich-data.ts", "prisma/seed/dates.ts"];
const read = (f: string) => readFileSync(root + f, "utf8");

describe("rich seed files: privacy and secrets (static)", () => {
  it("only reserved example domains for emails", () => {
    for (const f of RICH_FILES) {
      for (const m of read(f).matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9${}.-]+)/g)) {
        expect(m[1], `${f}: ${m[0]}`).toMatch(/example\.(test|com|invalid)$|^\$\{|\.example\.test`?$/);
      }
    }
  });

  it("every person in the rich layer is synthetic: 'Sample ' names, fake phone, no real-looking numbers", () => {
    for (const r of RICH as any[]) {
      for (const e of r.extras ?? r.members ?? []) {
        expect(e.name, e.key).toMatch(/^Sample /);
        if (e.guardianName) expect(e.guardianName, e.key).toMatch(/^Sample /);
      }
    }
    for (const f of RICH_FILES) {
      const text = read(f);
      for (const m of text.matchAll(/\+?\d[\d\s-]{9,}\d/g)) {
        const digits = m[0].replace(/\D/g, "");
        expect(/^(91)?0{10}$/.test(digits) || /^\d{4}-\d{2}-\d{2}/.test(m[0]) || digits.length < 10, `${f}: ${m[0]}`).toBe(true);
      }
    }
  });

  it("no URLs to real hosts, no secret-shaped tokens and no photos in the rich seed", () => {
    for (const f of RICH_FILES) {
      const text = read(f);
      for (const m of text.matchAll(/https?:\/\/([^/\s"'`]+)/g)) expect(m[1], `${f}: ${m[0]}`).toMatch(/(^|\.)(example\.(test|com|invalid)|localhost)$/);
      for (const re of [/AKIA[0-9A-Z]{16}/, /\bsk-[A-Za-z0-9_-]{20,}/, /\bgh[pousr]_[A-Za-z0-9]{20,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /postgres(ql)?:\/\//i, /\.(png|jpe?g|webp|heic)\b/i]) {
        expect(re.test(text), `${f}: ${re.source}`).toBe(false);
      }
    }
  });
});

describe("rich seed against local Postgres", () => {
  let prisma: PrismaClient | null = null;
  const today = "2026-11-21";
  let ids: string[] = [];

  beforeAll(async () => {
    prisma = await tryConnect();
    if (!prisma) return;
    ids = await seedDemo(prisma, { rich: true, today });
  }, 120_000);
  afterAll(async () => {
    if (!prisma) return;
    // Leave the shared database with the base layer only, as other suites expect.
    await seedDemo(prisma);
    await prisma.$disconnect();
  }, 120_000);

  const MODELS = ["tenant", "tenantTheme", "tenantSettings", "user", "guardian", "venue", "sport", "level", "batch", "batchMember", "member", "memberLevel", "session", "attendance", "holiday", "exercise", "workoutPlan", "workoutPlanDay", "workoutPlanItem", "planAssignment", "workoutLog", "goal", "goalCheckIn", "sessionBooking", "memberUpdate", "coachAvailability", "achievement", "excusedAbsence"];
  const snapshot = async (db: PrismaClient) => {
    const out: Record<string, number> = {};
    for (const m of MODELS) {
      try {
        out[m] = await (db as any)[m].count(m === "tenant" ? { where: { id: { in: ids } } } : { where: { tenantId: { in: ids } } });
      } catch {
        /* model without tenantId (child tables) is counted through its parent */
      }
    }
    for (const m of ["workoutPlanDay", "workoutPlanItem", "goalCheckIn"]) {
      if (out[m] === undefined) out[m] = await (db as any)[m].count();
    }
    return out;
  };

  it("is idempotent: a second run with the same date changes no row count and keeps the same tenant ids", async (ctx) => {
    if (!prisma) return ctx.skip();
    const first = await snapshot(prisma);
    expect(first.session).toBeGreaterThan(100);
    expect(first.workoutLog).toBeGreaterThan(50);
    const again = await seedDemo(prisma, { rich: true, today });
    expect(again).toEqual(ids);
    expect(await snapshot(prisma)).toEqual(first);
    // Also stable across a base-only run followed by the rich layer again.
    await seedDemo(prisma);
    expect((await snapshot(prisma)).workoutLog).toBe(0);
    await seedDemo(prisma, { rich: true, today });
    expect(await snapshot(prisma)).toEqual(first);
  }, 180_000);

  it("seed contains no real-looking personal data in the database either", async (ctx) => {
    if (!prisma) return ctx.skip();
    const users = await prisma.user.findMany({ where: { tenantId: { in: ids } }, select: { email: true, name: true } });
    for (const u of users) {
      expect(u.email ?? "", u.name ?? "").toMatch(/@([a-z0-9-]+\.)*example\.test$/);
      expect(u.name ?? "").toMatch(/^Sample /);
    }
    const members = await prisma.member.findMany({ where: { tenantId: { in: ids } }, select: { displayName: true } });
    for (const m of members) expect(m.displayName).toMatch(/^Sample /);
    const guardians = await prisma.guardian.findMany({ where: { tenantId: { in: ids } }, select: { name: true, phone: true } });
    for (const g of guardians) {
      expect(g.name).toMatch(/^Sample /);
      if (g.phone) expect(g.phone.replace(/\D/g, "")).toMatch(/^(91)?0+$|^9?0{3,}/);
    }
  });

  it("N+1 guard: owner analytics query counts stay flat across the rich tenants and under a fixed ceiling", async (ctx) => {
    if (!prisma) return ctx.skip();
    const counting = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
    let n = 0;
    (counting as any).$on("query", () => {
      n += 1;
    });
    const now = new Date(`${today}T12:00:00+05:30`);
    const q = (o: Record<string, string> = {}) => new URLSearchParams(o);
    try {
      const runs: [string, (db: any) => Promise<unknown>][] = [
        ["overview", (db) => getOwnerOverview(db, q(), now)],
        ["overview 90d", (db) => getOwnerOverview(db, q({ from: "2026-08-24", to: today }), now)],
        ["trends", (db) => getOwnerTrends(db, q({ periods: "6" }), now)],
        ["workload", (db) => getCoachWorkload(db, q(), now)],
        ["insights", (db) => getOwnerInsights(db, now)],
        ["fees", (db) => getFeeStats(db, now)],
        ["coaches", (db) => listCoaches(db, now)],
      ];
      const members = await Promise.all(ids.map((id) => prisma!.member.count({ where: { tenantId: id } })));
      expect(new Set(members).size, "tenants should differ in size for this test to mean anything").toBeGreaterThan(1);
      for (const [name, run] of runs) {
        const counts: number[] = [];
        await run(forTenant(counting, ids[0])); // warm-up: first use of a client may add connection queries
        for (const id of ids) {
          n = 0;
          await run(forTenant(counting, id));
          counts.push(n);
        }
        const detail = `${name} counts ${counts.join(",")} members ${members.join(",")}`;
        expect(Math.max(...counts) - Math.min(...counts), detail).toBeLessThanOrEqual(6);
        expect(Math.max(...counts), detail).toBeLessThan(45);
        // Same tenant twice: deterministic, i.e. no per-row loop that depends on cache state.
        n = 0;
        await run(forTenant(counting, ids[0]));
        expect(Math.abs(n - counts[0]), detail).toBeLessThanOrEqual(1);
      }
    } finally {
      await counting.$disconnect();
    }
  }, 120_000);
});
