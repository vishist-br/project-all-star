/**
 * STAR-107: the workout engine demo layer (prisma/seed/workout-engine.ts) against local Postgres:
 * fake per-set history that gives charts a shape, a karate class with a workout and published
 * summaries, belt checklists with partial sign-offs, badminton and swimming packs, idempotency.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { tryConnect } from "./helpers-db";
import { seedDemo } from "../prisma/seed/demo";
import { forTenant } from "../lib/tenant-scope";
import { getExerciseHistory } from "../lib/api/workout-sets";
import { getMemberSkillProgress } from "../lib/api/skills";
import { getClassInsights } from "../lib/api/class-insights";
import { getClassSummary, getSessionWorkout } from "../lib/api/class-summary";
import { loadOriginalEntries } from "../prisma/catalog/import";

/* eslint-disable @typescript-eslint/no-explicit-any */
const TODAY = "2026-11-21";

describe("workout engine seed", () => {
  let prisma: PrismaClient | null = null;
  let gym = "";
  let karate = "";
  const snapshot = async () => ({
    sets: await prisma!.workoutSet.count(),
    summaries: await prisma!.classSummary.count(),
    signOffs: await prisma!.skillSignOff.count(),
    checklists: await prisma!.skillChecklist.count(),
    classUpdates: await prisma!.memberUpdate.count({ where: { entityType: "class_summary" } }),
    attached: await prisma!.session.count({ where: { planDayId: { not: null } } }),
    logs: await prisma!.workoutLog.count(),
    plans: await prisma!.workoutPlan.count(),
    sports: await prisma!.sport.count(),
  });

  beforeAll(async () => {
    prisma = await tryConnect();
    if (!prisma) return;
    await seedDemo(prisma, { rich: true, today: TODAY });
    gym = (await prisma.tenant.findUniqueOrThrow({ where: { slug: "demo-gym" } })).id;
    karate = (await prisma.tenant.findUniqueOrThrow({ where: { slug: "demo-karate" } })).id;
  }, 120_000);
  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("is idempotent: a second run with the same date changes no count", async (ctx) => {
    if (!prisma) return ctx.skip();
    const first = await snapshot();
    expect(first.sets).toBeGreaterThan(1000);
    await seedDemo(prisma, { rich: true, today: TODAY });
    expect(await snapshot()).toEqual(first);
  }, 120_000);

  it("a gym member has per-set logs across about eight months, with warm-up, drop and failure sets and a superset block", async (ctx) => {
    if (!prisma) return ctx.skip();
    const m1 = "seed-demo-gym-member-m1";
    const logs = await prisma.workoutLog.findMany({ where: { memberId: m1, sets: { some: {} } }, select: { scheduledFor: true } });
    const dates = logs.map((l) => l.scheduledFor.toISOString().slice(0, 10)).sort();
    const spanDays = (Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / 86_400_000;
    expect(spanDays).toBeGreaterThan(200);
    const types = new Set((await prisma.workoutSet.findMany({ where: { tenantId: gym, log: { memberId: m1 } }, select: { setType: true } })).map((s) => s.setType));
    expect(types.has("WARMUP")).toBe(true);
    expect(types.has("NORMAL")).toBe(true);
    const grouped = await prisma.workoutPlanItem.findMany({ where: { tenantId: gym, supersetGroup: "A" } });
    expect(grouped.length).toBeGreaterThanOrEqual(4);
    expect(grouped.every((i) => i.rounds !== null)).toBe(true);
  });

  it("the squat history has shape: many sessions, a rising series and records with best weight at rep counts", async (ctx) => {
    if (!prisma) return ctx.skip();
    const db = forTenant(prisma, gym);
    const squat = await prisma.exercise.findFirstOrThrow({ where: { tenantId: gym, sourceId: "Barbell_Squat" } });
    const principal = { userId: "x", tenantId: gym, role: "owner" as const };
    const h: any = await getExerciseHistory(db, principal, "seed-demo-gym-member-m1", squat.id, new URLSearchParams("range=all"), new Date(`${TODAY}T10:00:00Z`));
    expect(h.sessions.length).toBeGreaterThan(30);
    const w = h.series.heaviestWeight;
    expect(w[w.length - 1].value).toBeGreaterThan(w[0].value);
    expect(h.records.heaviestWeight.value).toBe(Math.max(...w.map((p: any) => p.value)));
    expect(h.records.weightAtReps.length).toBeGreaterThanOrEqual(2);
    expect(h.series.oneRepMax.length).toBe(w.length);
    expect(h.newBests.length).toBeGreaterThan(3);
    const three = await getExerciseHistory(db, principal, "seed-demo-gym-member-m1", squat.id, new URLSearchParams(), new Date(`${TODAY}T10:00:00Z`));
    expect(three.sessions.length).toBeLessThan(h.sessions.length);
  });

  it("badminton drills log scores and times, the swim set logs distance and time", async (ctx) => {
    if (!prisma) return ctx.skip();
    const smash = await prisma.workoutSet.findMany({ where: { tenantId: gym, log: { planItem: { exercise: { sourceId: "badminton-smash-drill" } } } } });
    expect(smash.length).toBeGreaterThan(10);
    expect(smash.every((s) => s.scoreOf !== null && s.scoreMade !== null && s.scoreMade <= s.scoreOf!)).toBe(true);
    const swim = await prisma.workoutSet.findMany({ where: { tenantId: gym, log: { planItem: { exercise: { sourceId: "swim-freestyle-laps" } } } } });
    expect(swim.length).toBeGreaterThan(10);
    expect(swim.every((s) => (s.meters ?? 0) > 0 && (s.seconds ?? 0) > 0)).toBe(true);
    const steps = await prisma.exercise.findMany({ where: { tenantId: gym, sourceId: { in: ["badminton-shadow-footwork", "swim-kick-set", "badminton-smash-drill"] } } });
    expect(steps.map((e) => e.metricType).sort()).toEqual(["DISTANCE_TIME", "SCORE", "TIME"]);
    expect(steps.every((e) => e.needsTrainerReview)).toBe(true);
  });

  it("non-gym exercise drafts are flagged for trainer review and carry a metric; gym stays weight and reps", async (ctx) => {
    if (!prisma) return ctx.skip();
    for (const e of loadOriginalEntries()) expect(e.needsTrainerReview && ["REPS", "TIME", "DISTANCE_TIME", "SCORE", "CHECKLIST"].includes(e.metricType), e.sourceId).toBe(true);
    expect(await prisma.exercise.count({ where: { tenantId: gym, source: "FREE_EXERCISE_DB", metricType: { not: "WEIGHT_REPS" } } })).toBe(0);
    expect(await prisma.exercise.count({ where: { tenantId: gym, source: "ORIGINAL", needsTrainerReview: false } })).toBe(0);
    expect((await prisma.exercise.findFirstOrThrow({ where: { tenantId: karate, sourceId: "karate-kata-walkthrough" } })).metricType).toBe("CHECKLIST");
  });

  it("the karate kids class has a workout, published summaries and catch-up updates for absent members", async (ctx) => {
    if (!prisma) return ctx.skip();
    const db = forTenant(prisma, karate);
    const owner = { userId: "x", tenantId: karate, role: "owner" as const };
    const summaries = await prisma.classSummary.findMany({ where: { tenantId: karate }, include: { session: true } });
    expect(summaries.length).toBe(2);
    for (const s of summaries) {
      expect(s.session.planDayId).toBeTruthy();
      expect(s.coachNote).toMatch(/^Sample note/);
      const detail: any = await getClassSummary(db, owner, s.sessionId, new URLSearchParams());
      expect(detail.workout.blocks.some((b: any) => b.type === "superset" && b.label === "A" && b.rounds === 3)).toBe(true);
      expect(detail.counts.present).toBeGreaterThan(0);
    }
    const kinds = await prisma.memberUpdate.groupBy({ by: ["kind"], where: { tenantId: karate, entityType: "class_summary" }, _count: { _all: true } });
    expect(kinds.map((k) => k.kind)).toContain("CLASS_SUMMARY");
    expect(kinds.map((k) => k.kind)).toContain("CLASS_CATCHUP");
    // An upcoming class carries the workout too.
    const upcoming = await prisma.session.findFirstOrThrow({ where: { tenantId: karate, status: "SCHEDULED", planDayId: { not: null } } });
    expect(((await getSessionWorkout(db, owner, upcoming.id)) as any).workout.dayTitle).toBe("Kihon circuit");
    // Updates carry only the class name and date.
    const one = await prisma.memberUpdate.findFirstOrThrow({ where: { tenantId: karate, entityType: "class_summary" } });
    expect(Object.keys(one.params as object).sort()).toEqual(["batchName", "date"]);
  });

  it("belt checklists have partial sign-offs", async (ctx) => {
    if (!prisma) return ctx.skip();
    const db = forTenant(prisma, karate);
    const owner = { userId: "x", tenantId: karate, role: "owner" as const };
    const k1: any = await getMemberSkillProgress(db, owner, "seed-demo-karate-member-k1", new URLSearchParams());
    expect(k1.checklists.map((c: any) => c.levelName)).toEqual(["Yellow", "Orange", "Green"]);
    const yellow = k1.checklists[0];
    expect(yellow).toMatchObject({ doneCount: 3, totalCount: 6, percent: 50, complete: false, isNextLevel: true });
    expect(yellow.items.filter((i: any) => i.signedOff).every((i: any) => i.rating >= 2 && i.rating <= 4 && i.signedOffByName)).toBe(true);
    const k2: any = await getMemberSkillProgress(db, owner, "seed-demo-karate-member-k2", new URLSearchParams());
    expect(k2.checklists[0]).toMatchObject({ doneCount: 5, totalCount: 6, isNextLevel: true });
  });

  it("class insights run on the seeded demo gym and carry no coach", async (ctx) => {
    if (!prisma) return ctx.skip();
    const r: any = await getClassInsights(forTenant(prisma, gym), new URLSearchParams(), new Date(`${TODAY}T12:00:00Z`));
    expect(r.slots.length).toBeGreaterThanOrEqual(2);
    expect(r.overall.classesHeld).toBeGreaterThan(5);
    expect(JSON.stringify(r)).not.toMatch(/Trainer|coach/i);
  });

  it("static privacy: the layer has no email, phone, URL or photo", () => {
    const text = readFileSync(new URL("../prisma/seed/workout-engine.ts", import.meta.url), "utf8");
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toMatch(/\.(png|jpe?g|webp|heic)\b/i);
    expect(text).not.toMatch(/\+?\d[\d\s-]{9,}\d/);
    for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9${}.-]+)/g)) expect(m[1]).toMatch(/\.example\.test`?$/);
  });
});
