/**
 * STAR-114: plan folders and templates, body measurements and muscle volume, against local Postgres.
 * Role and tenant rules of every operation are in api-matrix.test.ts; this file covers behaviour,
 * privacy of weight data and the demo seed layer (idempotent, fake people only).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { tryConnect } from "./helpers-db";
import { buildWorld, call, d, type World } from "./helpers-api";
import { seedDemo } from "../prisma/seed/demo";
import { forTenant } from "../lib/tenant-scope";
import { getMuscleVolume } from "../lib/api/muscle-volume";
import { GET as listPlans } from "../app/api/v1/workout-plans/route";
import { POST as duplicate } from "../app/api/v1/workout-plans/[planId]/duplicate/route";
import { PUT as moveToFolder } from "../app/api/v1/workout-plans/[planId]/folder/route";
import { GET as getPlan } from "../app/api/v1/workout-plans/[planId]/route";
import { GET as listTemplates } from "../app/api/v1/plan-templates/route";
import { GET as listFolders, POST as createFolder } from "../app/api/v1/plan-folders/route";
import { DELETE as deleteFolder, PATCH as renameFolder } from "../app/api/v1/plan-folders/[folderId]/route";
import { POST as assign } from "../app/api/v1/plan-assignments/route";
import { GET as listBody, POST as recordBody } from "../app/api/v1/members/[memberId]/body-measurements/route";
import { DELETE as deleteBody } from "../app/api/v1/members/[memberId]/body-measurements/[measurementId]/route";

/* eslint-disable @typescript-eslint/no-explicit-any */

describe("gym extras (local Postgres)", () => {
  let prisma: PrismaClient | null = null;
  let w: World;

  beforeAll(async () => {
    prisma = await tryConnect();
    if (!prisma) return;
    w = await buildWorld(prisma, "gx114");
  }, 60_000);
  afterAll(async () => {
    if (!prisma) return;
    await w?.cleanup();
    await prisma.$disconnect();
  });

  it("duplicates a plan, saves a template, makes a plan from it, and keeps templates out of the plan list and assignments", async (ctx) => {
    if (!prisma) return ctx.skip();
    const { A } = w;
    const dup = await call(duplicate, "POST", "", A.token.coach, { params: { planId: A.ids.plan }, body: {} });
    expect(dup.status).toBe(201);
    expect(dup.body.title).toMatch(/\(copy\)$/);
    expect(dup.body.isTemplate).toBe(false);
    expect(dup.body.version).toBe(1);
    expect(dup.body.days[0].items).toHaveLength(2);
    expect(dup.body.id).not.toBe(A.ids.plan);

    const tpl = await call(duplicate, "POST", "", A.token.coach, { params: { planId: A.ids.plan }, body: { asTemplate: true, title: "Starter template" } });
    expect(tpl.status).toBe(201);
    expect(tpl.body).toMatchObject({ title: "Starter template", isTemplate: true, folderId: null });

    const templates = await call(listTemplates, "GET", "", A.token.coach);
    expect(templates.body.items.map((p: any) => p.id)).toContain(tpl.body.id);
    const plans = await call(listPlans, "GET", "?limit=100", A.token.coach);
    expect(plans.body.items.map((p: any) => p.id)).not.toContain(tpl.body.id);
    expect(plans.body.items.map((p: any) => p.id)).toContain(dup.body.id);
    // Another coach never sees them; the owner does.
    expect((await call(listTemplates, "GET", "", A.token.coachX)).body.items).toEqual([]);
    expect((await call(listTemplates, "GET", "", A.token.owner)).body.items.map((p: any) => p.id)).toContain(tpl.body.id);

    // A template is not assignable; a plan made from it is.
    const bad = await call(assign, "POST", "", A.token.coach, { body: { planId: tpl.body.id, memberIds: [A.ids.kid], startsOn: d(0) } });
    expect(bad.status).toBe(409);
    const used = await call(duplicate, "POST", "", A.token.coach, { params: { planId: tpl.body.id }, body: {} });
    expect(used.status).toBe(201);
    expect(used.body).toMatchObject({ title: "Starter template", isTemplate: false });
    expect(used.body.days[0].items.map((i: any) => i.exerciseId)).toEqual(tpl.body.days[0].items.map((i: any) => i.exerciseId));
    const ok = await call(assign, "POST", "", A.token.coach, { body: { planId: used.body.id, memberIds: [A.ids.kid], startsOn: d(0) } });
    expect(ok.status).toBe(201);
  });

  it("validates duplicate input and another coach's plan is not copyable", async (ctx) => {
    if (!prisma) return ctx.skip();
    const { A } = w;
    expect((await call(duplicate, "POST", "", A.token.coach, { params: { planId: A.ids.plan }, body: { title: "" } })).status).toBe(400);
    expect((await call(duplicate, "POST", "", A.token.coach, { params: { planId: A.ids.plan }, body: { asTemplate: "yes" } })).status).toBe(400);
    expect((await call(duplicate, "POST", "", A.token.coachX, { params: { planId: A.ids.plan }, body: {} })).status).toBe(403);
    expect((await call(duplicate, "POST", "", A.token.parent, { params: { planId: A.ids.plan }, body: {} })).status).toBe(403);
  });

  it("folders: create, rename, unique names, move plans, delete keeps the plans", async (ctx) => {
    if (!prisma) return ctx.skip();
    const { A, B } = w;
    const made = await call(createFolder, "POST", "", A.token.coachX, { body: { name: "Mine" } });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ name: "Mine", planCount: 0 });
    expect((await call(createFolder, "POST", "", A.token.coachX, { body: { name: "mine" } })).status).toBe(409);
    expect((await call(createFolder, "POST", "", A.token.coachX, { body: { name: "  " } })).status).toBe(400);
    const second = await call(createFolder, "POST", "", A.token.coachX, { body: { name: "Second" } });
    expect(second.body.order).toBeGreaterThan(made.body.order);

    const renamed = await call(renameFolder, "PATCH", "", A.token.coachX, { params: { folderId: made.body.id }, body: { name: "Renamed" } });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe("Renamed");
    expect((await call(renameFolder, "PATCH", "", A.token.coachX, { params: { folderId: made.body.id }, body: { name: "Second" } })).status).toBe(409);

    // Another coach neither sees nor uses the folder; the owner does.
    expect((await call(listFolders, "GET", "", A.token.coach)).body.items.map((f: any) => f.id)).not.toContain(made.body.id);
    expect((await call(listFolders, "GET", "", A.token.owner)).body.items.map((f: any) => f.id)).toContain(made.body.id);
    // The coach's own plan goes into the coach's folder, not into another coach's.
    const plan = await A.fresh.plan();
    const otherFolder = made.body.id as string;
    expect((await call(moveToFolder, "PUT", "", A.token.coach, { params: { planId: plan.id }, body: { folderId: otherFolder } })).status).toBe(403);
    const folder = await call(createFolder, "POST", "", A.token.coach, { body: { name: `Own ${plan.id.slice(-6)}` } });
    const moved = await call(moveToFolder, "PUT", "", A.token.coach, { params: { planId: plan.id }, body: { folderId: folder.body.id } });
    expect(moved.status).toBe(200);
    expect(moved.body.folderId).toBe(folder.body.id);
    expect((await call(getPlan, "GET", "", A.token.coach, { params: { planId: plan.id } })).body.folderId).toBe(folder.body.id);
    const listed = await call(listFolders, "GET", "", A.token.coach);
    expect(listed.body.items.find((f: any) => f.id === folder.body.id).planCount).toBe(1);
    // Filter by folder, and "none".
    expect((await call(listPlans, "GET", `?folderId=${folder.body.id}`, A.token.coach)).body.items.map((p: any) => p.id)).toEqual([plan.id]);
    expect((await call(listPlans, "GET", "?folderId=none&limit=100", A.token.coach)).body.items.map((p: any) => p.id)).not.toContain(plan.id);
    expect((await call(moveToFolder, "PUT", "", A.token.coach, { params: { planId: plan.id }, body: {} })).status).toBe(400);

    const del = await call(deleteFolder, "DELETE", "", A.token.coach, { params: { folderId: folder.body.id } });
    expect(del.status).toBe(204);
    const after = await call(getPlan, "GET", "", A.token.coach, { params: { planId: plan.id } });
    expect(after.status).toBe(200);
    expect(after.body.folderId).toBeNull();
    // Folders of another business are 404.
    expect((await call(deleteFolder, "DELETE", "", B.token.coach, { params: { folderId: made.body.id } })).status).toBe(404);
    const moveB = await call(moveToFolder, "PUT", "", B.token.coach, { params: { planId: B.ids.plan }, body: { folderId: made.body.id } });
    expect(moveB.status).toBe(404);
  });

  it("body measurements: the family records and deletes, the coach and owner read, nobody else sees weight", async (ctx) => {
    if (!prisma) return ctx.skip();
    const { A, B } = w;
    const params = { memberId: A.ids.kid };
    const rec = await call(recordBody, "POST", "", A.token.parent, { params, body: { weightKg: 41.4, waistCm: 58, measuredOn: d(-10), note: "Sample" } });
    expect(rec.status).toBe(201);
    expect(rec.body).toMatchObject({ weightKg: 41.4, waistCm: 58, bodyFatPct: null, measuredOn: d(-10) });
    // The same day replaces the entry.
    const again = await call(recordBody, "POST", "", A.token.parent, { params, body: { weightKg: 41.9, measuredOn: d(-10) } });
    expect(again.body.id).toBe(rec.body.id);
    expect(again.body).toMatchObject({ weightKg: 41.9, waistCm: null });
    const latest = await call(recordBody, "POST", "", A.token.parent, { params, body: { weightKg: 42.3 } });
    expect(latest.body.measuredOn).toBe(d(0));
    expect((await call(recordBody, "POST", "", A.token.parent, { params, body: { weightKg: 42, measuredOn: d(3) } })).status).toBe(400);
    expect((await call(recordBody, "POST", "", A.token.parent, { params, body: { weightKg: "heavy" } })).status).toBe(400);

    const list = await call(listBody, "GET", "", A.token.parent, { params });
    expect(list.status).toBe(200);
    expect(list.body.items.map((m: any) => m.measuredOn)).toEqual([...list.body.items.map((m: any) => m.measuredOn)].sort());
    expect(list.body.latest.id).toBe(latest.body.id);
    // Coach of the batch and owner read; the other coach, another family and another business do not.
    expect((await call(listBody, "GET", "", A.token.coach, { params })).status).toBe(200);
    expect((await call(listBody, "GET", "", A.token.owner, { params })).status).toBe(200);
    expect((await call(listBody, "GET", "", A.token.coachX, { params })).status).toBe(403);
    expect((await call(listBody, "GET", "", A.token.stranger, { params })).status).toBe(403);
    expect((await call(listBody, "GET", "", B.token.owner, { params })).status).toBe(404);
    // Read only for staff.
    for (const who of ["coach", "owner"] as const) expect((await call(recordBody, "POST", "", A.token[who], { params, body: { weightKg: 50 } })).status).toBe(403);
    expect((await call(deleteBody, "DELETE", "", A.token.coach, { params: { ...params, measurementId: latest.body.id } })).status).toBe(403);
    expect((await call(deleteBody, "DELETE", "", A.token.stranger, { params: { ...params, measurementId: latest.body.id } })).status).toBe(403);

    expect((await call(deleteBody, "DELETE", "", A.token.parent, { params: { ...params, measurementId: latest.body.id } })).status).toBe(204);
    expect((await call(deleteBody, "DELETE", "", A.token.parent, { params: { ...params, measurementId: latest.body.id } })).status).toBe(404);
    const rows = await call(listBody, "GET", "", A.token.parent, { params });
    // The fixture entry (200 days ago) stays, then the replaced entry; the deleted one is gone.
    expect(rows.body.items.map((m: any) => m.id)).toEqual([A.ids.measurement, rec.body.id]);
    // A measurement id of another member is not deletable through this member.
    const other = await prisma.bodyMeasurement.create({ data: { tenantId: A.id, memberId: A.ids.m2, measuredOn: new Date(`${d(-5)}T00:00:00Z`), weightKg: 70 } });
    expect((await call(deleteBody, "DELETE", "", A.token.parent, { params: { ...params, measurementId: other.id } })).status).toBe(404);
  });
});

describe("gym extras demo seed (local Postgres)", () => {
  let prisma: PrismaClient | null = null;
  const TODAY = "2026-11-26";

  beforeAll(async () => {
    prisma = await tryConnect();
    if (!prisma) return;
    await seedDemo(prisma, { rich: true, today: TODAY });
  }, 180_000);
  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("seeds months of measurements for two gym members, a folder with two plans and a template; a second run changes nothing", async (ctx) => {
    if (!prisma) return ctx.skip();
    const snap = async () => ({
      m1: await prisma!.bodyMeasurement.count({ where: { memberId: "seed-demo-gym-member-m1" } }),
      m2: await prisma!.bodyMeasurement.count({ where: { memberId: "seed-demo-gym-member-m2" } }),
      folders: await prisma!.planFolder.count(),
      inFolder: await prisma!.workoutPlan.count({ where: { folder: { id: { startsWith: "seed-demo-gym-r-gx-" } } } }),
      templates: await prisma!.workoutPlan.count({ where: { isTemplate: true } }),
      measurements: await prisma!.bodyMeasurement.count(),
    });
    const first = await snap();
    expect(first.m1).toBeGreaterThanOrEqual(10);
    expect(first.m2).toBeGreaterThanOrEqual(7);
    expect(first.folders).toBe(1);
    expect(first.inFolder).toBe(2);
    expect(first.templates).toBe(1);
    const dates = (await prisma.bodyMeasurement.findMany({ where: { memberId: "seed-demo-gym-member-m1" }, select: { measuredOn: true }, orderBy: { measuredOn: "asc" } })).map((r) => r.measuredOn.toISOString().slice(0, 10));
    expect(Date.parse(dates[dates.length - 1]!) - Date.parse(dates[0]!)).toBeGreaterThan(150 * 86_400_000);
    await seedDemo(prisma, { rich: true, today: TODAY });
    expect(await snap()).toEqual(first);
    // clearRich removes the layer (the base seed run drops the rich layer).
    await seedDemo(prisma, { today: TODAY });
    expect(await prisma.bodyMeasurement.count()).toBe(0);
    expect(await prisma.planFolder.count()).toBe(0);
    expect(await prisma.workoutPlan.count({ where: { isTemplate: true } })).toBe(0);
    await seedDemo(prisma, { rich: true, today: TODAY });
  }, 240_000);

  it("muscle volume of a seeded gym member reads logged sets; a karate member has none", async (ctx) => {
    if (!prisma) return ctx.skip();
    const gym = (await prisma.tenant.findUniqueOrThrow({ where: { slug: "demo-gym" } })).id;
    const karate = (await prisma.tenant.findUniqueOrThrow({ where: { slug: "demo-karate" } })).id;
    const owner = async (tenantId: string) => ({ userId: (await prisma!.user.findFirstOrThrow({ where: { tenantId, role: "OWNER" } })).id, tenantId, role: "owner" as const });
    const now = new Date(`${TODAY}T10:00:00Z`);
    const g = await getMuscleVolume(forTenant(prisma, gym), await owner(gym), "seed-demo-gym-member-m1", new URLSearchParams("range=28d"), now);
    expect(g.hasGymData).toBe(true);
    expect(g.weeks).toBe(4);
    expect(g.muscles.length).toBeGreaterThan(0);
    expect(g.totalSets).toBeGreaterThan(0);
    const week = await getMuscleVolume(forTenant(prisma, gym), await owner(gym), "seed-demo-gym-member-m1", new URLSearchParams("range=7d"), now);
    expect(week.totalSets).toBeLessThanOrEqual(g.totalSets);
    const k = await getMuscleVolume(forTenant(prisma, karate), await owner(karate), "seed-demo-karate-member-k1", new URLSearchParams(), now);
    expect(k).toMatchObject({ hasGymData: false, muscles: [], totalSets: 0 });
  });
});
