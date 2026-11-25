import type { PrismaClient } from "@prisma/client";
import { addDays, dbDate, rnd } from "./dates";

// Gym extras demo layer (STAR-114), demo-gym only. Runs after the workout engine layer:
//  - body measurements over about six months for two gym members (sample numbers, fake people)
//  - a plan folder owned by the first demo trainer with two of their plans in it, and one template
// Rows use ids starting with `seed-<slug>-r-gx-`, so clearRich() removes them (idempotent re-seed).

const GX = (slug: string) => `seed-${slug}-r-gx-`;

/** Removes everything this layer wrote. Called by clearRich before the plans go (folders are cleared last: plans keep no reference). */
export async function clearGymExtras(prisma: PrismaClient, tenantId: string, slug: string): Promise<void> {
  const byId = { id: { startsWith: GX(slug) } };
  await prisma.bodyMeasurement.deleteMany({ where: { tenantId, ...byId } });
  await prisma.workoutPlan.updateMany({ where: { tenantId, folder: byId }, data: { folderId: null } });
  await prisma.workoutPlan.deleteMany({ where: { tenantId, ...byId } });
  await prisma.planFolder.deleteMany({ where: { tenantId, ...byId } });
}

type Profile = { start: number; end: number; fat: [number, number] | null; waist: [number, number]; chest: [number, number] | null; arm: [number, number] | null; every: number };
const PROFILES: Record<string, Profile> = {
  // m1 trains for strength: weight edges up, waist steady, arm grows.
  m1: { start: 74.2, end: 77.1, fat: [19.5, 17.8], waist: [84, 83], chest: [98, 101], arm: [33.5, 35.2], every: 14 },
  // m2 follows a leaner plan: weight edges down.
  m2: { start: 82.6, end: 79.4, fat: [26.1, 23.7], waist: [92, 88], chest: null, arm: null, every: 21 },
};

const mix = (a: number, b: number, f: number) => a + (b - a) * f;
const r1 = (n: number) => Math.round(n * 10) / 10;

export async function seedGymExtras(prisma: PrismaClient, slug: string, today: string): Promise<Record<string, number>> {
  if (slug !== "demo-gym") return {};
  const P = GX(slug);
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug }, select: { id: true } });
  const tenantId = tenant.id;
  const counts = { measurements: 0, folders: 0, folderPlans: 0, templates: 0 };

  // 1. Body measurements, oldest 26 weeks ago, then every two or three weeks up to this week.
  for (const [mk, pr] of Object.entries(PROFILES)) {
    const memberId = `seed-${slug}-member-${mk}`;
    const rows = [];
    const days: number[] = [];
    for (let d = 182; d >= 0; d -= pr.every) days.push(d);
    for (const [i, ago] of days.entries()) {
      const f = days.length === 1 ? 1 : i / (days.length - 1);
      const jit = (k: string, span: number) => (rnd(slug, mk, "bm", i, k) - 0.5) * span;
      rows.push({
        id: `${P}bm-${mk}-${i}`,
        tenantId,
        memberId,
        measuredOn: dbDate(addDays(today, -ago)),
        weightKg: r1(mix(pr.start, pr.end, f) + jit("w", 0.8)),
        bodyFatPct: pr.fat && i % 2 === 0 ? r1(mix(pr.fat[0], pr.fat[1], f) + jit("f", 0.6)) : null,
        waistCm: r1(mix(pr.waist[0], pr.waist[1], f) + jit("wa", 0.8)),
        chestCm: pr.chest && i % 3 === 0 ? r1(mix(pr.chest[0], pr.chest[1], f) + jit("c", 0.6)) : null,
        armCm: pr.arm && i % 3 === 0 ? r1(mix(pr.arm[0], pr.arm[1], f) + jit("a", 0.4)) : null,
        note: i === 0 ? "Sample note: first check-in." : null,
      });
    }
    await prisma.bodyMeasurement.createMany({ data: rows });
    counts.measurements += rows.length;
  }

  // 2. A folder with two of the first trainer's plans, and a template copied from one of them.
  const coach = await prisma.user.findUniqueOrThrow({ where: { tenantId_email: { tenantId, email: `c1@${slug}.example.test` } }, select: { id: true } });
  const folderId = `${P}folder-starter`;
  await prisma.planFolder.create({ data: { id: folderId, tenantId, coachId: coach.id, name: "Starter programs (sample)", sortOrder: 1 } });
  counts.folders = 1;
  const inFolder = await prisma.workoutPlan.updateMany({
    where: { tenantId, id: { in: [`seed-${slug}-r-plan-full-body`, `seed-${slug}-r-plan-mobility`] }, coachId: coach.id },
    data: { folderId },
  });
  counts.folderPlans = inFolder.count;

  const src = await prisma.workoutPlan.findFirst({
    where: { tenantId, id: `seed-${slug}-r-plan-full-body` },
    include: { days: { include: { items: { where: { archivedAt: null } } } } },
  });
  if (src) {
    const tid = `${P}template-full-body`;
    await prisma.workoutPlan.create({
      data: { id: tid, tenantId, coachId: coach.id, title: "Full body starter (template)", description: src.description, cadence: src.cadence, sportSlug: src.sportSlug, status: "ACTIVE", isTemplate: true },
    });
    for (const d of src.days) {
      const dayId = `${tid}-d${d.dayIndex}`;
      await prisma.workoutPlanDay.create({ data: { id: dayId, tenantId, planId: tid, dayIndex: d.dayIndex, title: d.title, notes: d.notes } });
      for (const [n, i] of d.items.entries()) {
        await prisma.workoutPlanItem.create({
          data: {
            id: `${dayId}-i${n}`, tenantId, dayId, exerciseId: i.exerciseId, position: i.position, sets: i.sets, reps: i.reps, durationSeconds: i.durationSeconds,
            restSeconds: i.restSeconds, supersetGroup: i.supersetGroup, rounds: i.rounds, targetWeightKg: i.targetWeightKg, targetDistanceMeters: i.targetDistanceMeters, notes: i.notes,
          },
        });
      }
    }
    counts.templates = 1;
  }
  return counts;
}
