/**
 * STAR-91 / STAR-92: speed guards. The batched roster stats must equal getMemberStats per member,
 * every role route must sit under a loading skeleton, and navigation must use next/link (prefetch).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { tryConnect } from "./helpers-db";
import { getMemberStats } from "../lib/api/member-stats";
import { getRosterStats } from "../lib/api/roster-stats";
import { forTenant } from "../lib/tenant-scope";
import { BarChart } from "../components/charts/BarChart";
import { r1 } from "../components/charts/scale";

const root = new URL("..", import.meta.url).pathname;
const read = (f: string) => readFileSync(root + f, "utf8");

let prisma: PrismaClient | null = null;
beforeAll(async () => {
  prisma = await tryConnect();
});
afterAll(async () => {
  await prisma?.$disconnect();
});

describe("getRosterStats", () => {
  it("matches getMemberStats attendance and adherence for every member of a demo tenant", async () => {
    if (!prisma) return;
    const tenant = await prisma.tenant.findUnique({ where: { slug: "demo-gym" }, select: { id: true } });
    if (!tenant) return;
    const owner = await prisma.user.findFirst({ where: { tenantId: tenant.id, role: "OWNER" }, select: { id: true } });
    if (!owner) return;
    const db = forTenant(prisma, tenant.id);
    const principal = { userId: owner.id, tenantId: tenant.id, role: "owner" as const };
    const members = await db.member.findMany({ select: { id: true }, take: 40 });
    const now = new Date();
    const today = new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
    const from = new Date(new Date(`${today}T00:00:00Z`).getTime() - 29 * 86_400_000).toISOString().slice(0, 10);
    const batch = await getRosterStats(db, members.map((m) => m.id), from, today, now);
    expect(batch.size).toBe(members.length);
    for (const m of members) {
      const one = await getMemberStats(db, principal, m.id, new URLSearchParams({ from, to: today }), now);
      const b = batch.get(m.id)!;
      expect(b.attendance, m.id).toEqual({ attended: one.attendance.attended, missed: one.attendance.missed, excused: one.attendance.excused, percent: one.attendance.percent });
      expect(b.workouts, m.id).toEqual({ scheduled: one.workouts.scheduled, completed: one.workouts.completed, adherencePercent: one.workouts.adherencePercent });
    }
  });

  it("returns an empty map for no members without querying", async () => {
    expect((await getRosterStats(null as never, [], "2026-01-01", "2026-01-30")).size).toBe(0);
  });
});

describe("chart coordinates", () => {
  it("r1 rounds to one decimal", () => {
    expect(r1(7.459999999999999)).toBe(7.5);
    expect(r1(291.79)).toBe(291.8);
  });
  it("bar chart markup carries no long floats", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const html = renderToStaticMarkup(createElement(BarChart, { labels: ["a", "b", "c", "d", "e", "f", "g"], series: [{ name: "x", values: [1, 2, 3, 4, 5, 6, 7] }], ariaLabel: "t" }));
    expect(html).not.toMatch(/\d\.\d{3,}/);
  });
});

describe("navigation speed", () => {
  const roles = ["owner", "coach", "customer"];
  it("one loading skeleton covers every role route", () => {
    expect(existsSync(root + "app/[role]/loading.tsx")).toBe(true);
    expect(existsSync(root + "app/[role]/error.tsx")).toBe(true);
  });
  it("heavy owner routes have their own skeleton", () => {
    for (const s of ["dashboard", "batches", "coaches", "settings"]) expect(existsSync(root + `app/[role]/${s}/loading.tsx`), s).toBe(true);
  });
  it("the data-heavy screens added in later sprints have their own skeleton (STAR-102)", () => {
    for (const s of [
      "workouts/live",
      "classes",
      "progress/exercises",
      "progress/skills",
      "exercise/[exerciseId]",
      "insights",
      "plans/[planId]/results",
      "plans/[planId]/send",
    ]) {
      expect(existsSync(root + `app/[role]/${s}/loading.tsx`), s).toBe(true);
    }
  });
  it("every page under a role route sits under a loading skeleton", () => {
    const walk = (dir: string, covered: boolean): string[] => {
      const here = covered || existsSync(`${dir}/loading.tsx`);
      const missing: string[] = [];
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) missing.push(...walk(`${dir}/${e.name}`, here));
        else if (e.name === "page.tsx" && !here) missing.push(dir);
      }
      return missing;
    };
    expect(walk(root + "app/[role]", false)).toEqual([]);
  });
  it("nav links are next/link with default prefetch", () => {
    const nav = read("components/NavLink.tsx");
    expect(nav).toContain('from "next/link"');
    expect(nav).not.toMatch(/prefetch=\{false\}/);
    expect(roles.length).toBe(3);
    for (const f of ["components/AppShell.tsx", "components/ui/Button.tsx"]) expect(read(f)).toContain('from "next/link"');
  });
  it("no component disables prefetch", () => {
    for (const f of ["components/AppShell.tsx", "components/NavLink.tsx", "components/ui/Button.tsx", "components/WorkoutsScreen.tsx"]) {
      expect(read(f)).not.toMatch(/prefetch=\{false\}/);
    }
  });
});

describe("Server-Timing header (STAR-93)", () => {
  it("formats only a metric name and a duration", async () => {
    const { serverTimingHeader } = await import("../lib/server-timing");
    expect(serverTimingHeader(10, 12.34)).toBe("proxy;dur=2.3");
    expect(serverTimingHeader(10, 5)).toBe("proxy;dur=0.0");
  });
  it("proxy.ts sets it on every response", () => {
    expect(read("proxy.ts")).toContain('res.headers.set("Server-Timing"');
  });
});
