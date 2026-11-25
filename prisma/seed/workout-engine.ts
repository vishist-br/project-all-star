import type { Prisma, PrismaClient } from "@prisma/client";
import { publishSummaryTx } from "../../lib/api/class-summary";
import { sessionInclude } from "../../lib/api/session-detail";
import { forTenant } from "../../lib/tenant-scope";
import { expandSchedule } from "../../lib/workouts/expand";
import { deriveLogTotals, type SetLike } from "../../lib/workouts/records";
import { addDays, dbDate, daysBetween, istAt, rnd } from "./dates";

// Workout engine demo layer (STAR-107). Runs after the rich layer, on the same three demo tenants:
//  - demo-gym: per-set logs across about eight months for Sample Member 01 (a finished strength block
//    with a superset, plus sets on the current full-body plan), a badminton drill plan and a swimming set
//  - demo-karate: a kids class with an attached class workout, published after-class summaries (with
//    catch-up updates for absent members) and belt checklists with partial sign-offs
// Rows use ids starting with `seed-<slug>-r-we-` so the layer is cleared and rewritten (idempotent).
// All people are synthetic. New non-gym exercise drafts are flagged "needs trainer review" by the catalog.

const WE = (slug: string) => `seed-${slug}-r-we-`;

/** Removes everything this layer wrote. Called by clearRich before the rich rows go. */
export async function clearWorkoutEngine(prisma: PrismaClient, tenantId: string, slug: string): Promise<void> {
  const byId = { id: { startsWith: WE(slug) } };
  await prisma.memberUpdate.deleteMany({ where: { tenantId, entityType: "class_summary" } });
  await prisma.classSummary.deleteMany({ where: { tenantId } }); // shares cascade
  await prisma.skillSignOff.deleteMany({ where: byId });
  await prisma.skillItem.deleteMany({ where: byId });
  await prisma.skillChecklist.deleteMany({ where: byId });
  await prisma.workoutSet.deleteMany({ where: { tenantId, id: { startsWith: `seed-${slug}-r-` } } });
}

/** Sports created by this layer (deleted after the plans that point at them, nothing else does). */
export async function clearWorkoutEngineSports(prisma: PrismaClient, slug: string): Promise<void> {
  await prisma.sport.deleteMany({ where: { id: { startsWith: WE(slug) } } });
}

// ---- set generators ----

const round = (n: number, to: number) => Math.round(n / to) * to;
type SetSpec = { setNumber: number; setType: "NORMAL" | "WARMUP" | "DROP" | "FAILURE"; weightKg: number | null; reps: number | null; seconds: number | null; meters: number | null; scoreMade: number | null; scoreOf: number | null };
const blank: Omit<SetSpec, "setNumber" | "setType"> = { weightKg: null, reps: null, seconds: null, meters: null, scoreMade: null, scoreOf: null };

/** Working weights in kg for the gym lifts used by the demo plans (beginner to early intermediate). */
const BASE_KG: Record<string, number> = {
  Barbell_Squat: 40, "Barbell_Bench_Press_-_Medium_Grip": 30, Bent_Over_Barbell_Row: 30, Barbell_Deadlift: 50, Dumbbell_Shoulder_Press: 10,
  "Wide-Grip_Lat_Pulldown": 35, Goblet_Squat: 14, Dumbbell_Bench_Press: 12, Seated_Cable_Rows: 30, Romanian_Deadlift: 40, Leg_Press: 80,
};
const COMPOUND = new Set(["Barbell_Squat", "Barbell_Bench_Press_-_Medium_Grip", "Barbell_Deadlift", "Bent_Over_Barbell_Row"]);

type Gen = { seed: string; exercise: string; sets: number; reps: number | null; dur: number | null; target: number | null; meters: number | null; progress: number; scale: number; metric: "WEIGHT_REPS" | "REPS" | "TIME" | "DISTANCE_TIME" | "SCORE" };

function genSets(g: Gen): SetSpec[] {
  const out: SetSpec[] = [];
  const n = Math.max(1, g.sets);
  const jitter = (k: string) => rnd(g.seed, g.exercise, k);
  let no = 1;
  if (g.metric === "TIME") {
    for (let i = 0; i < n; i++) out.push({ ...blank, setNumber: no++, setType: "NORMAL", seconds: Math.max(10, Math.round((g.dur ?? 45) * (0.85 + 0.25 * g.progress) + jitter(`t${i}`) * 6)) });
    return out;
  }
  if (g.metric === "SCORE") {
    const of = g.reps ?? 20;
    for (let i = 0; i < n; i++) out.push({ ...blank, setNumber: no++, setType: "NORMAL", scoreOf: of, scoreMade: Math.min(of, Math.round(of * (0.4 + 0.32 * g.progress + (jitter(`s${i}`) - 0.5) * 0.12))) });
    return out;
  }
  if (g.metric === "DISTANCE_TIME") {
    const m = g.meters ?? 50;
    const pace = g.exercise.includes("kick") ? 150 : g.exercise.includes("pull") ? 118 : 128; // seconds per 100 m at the start
    for (let i = 0; i < n; i++) out.push({ ...blank, setNumber: no++, setType: "NORMAL", meters: m, seconds: Math.round(((pace * (1 - 0.14 * g.progress) + (jitter(`d${i}`) - 0.5) * 6) * m) / 100) });
    return out;
  }
  const base = BASE_KG[g.exercise];
  if (g.metric === "WEIGHT_REPS" && base && g.reps) {
    const w = Math.max(5, round(base * g.scale * (1 + 0.35 * g.progress), 2.5));
    if (COMPOUND.has(g.exercise)) out.push({ ...blank, setNumber: no++, setType: "WARMUP", weightKg: round(w * 0.6, 2.5), reps: 10 });
    for (let i = 0; i < n; i++) {
      const last = i === n - 1;
      const reps = Math.max(1, g.reps - (last && jitter("last") < 0.5 ? 1 : 0) - (jitter(`r${i}`) < 0.15 ? 1 : 0));
      out.push({ ...blank, setNumber: no++, setType: last && jitter("fail") < 0.12 ? "FAILURE" : "NORMAL", weightKg: w, reps });
    }
    if (jitter("drop") < 0.1) out.push({ ...blank, setNumber: no++, setType: "DROP", weightKg: round(w * 0.8, 2.5), reps: g.reps });
    return out;
  }
  if (g.dur && !g.reps) {
    for (let i = 0; i < n; i++) out.push({ ...blank, setNumber: no++, setType: "NORMAL", seconds: Math.round(g.dur * (0.9 + 0.2 * g.progress) + jitter(`p${i}`) * 5) });
    return out;
  }
  for (let i = 0; i < n; i++) out.push({ ...blank, setNumber: no++, setType: "NORMAL", reps: Math.max(1, (g.reps ?? 10) - (jitter(`b${i}`) < 0.2 ? 1 : 0)) });
  return out;
}

const toLike = (s: SetSpec): SetLike => s;

// ---- shared helpers ----

type ItemDef = { ex: string; sets?: number; reps?: number; dur?: number; rest?: number; target?: number; meters?: number; group?: string; rounds?: number };
type DayDef = { dayIndex: number; title: string; items: ItemDef[] };

async function loadContext(prisma: PrismaClient, slug: string) {
  const tenantId = (await prisma.tenant.findUniqueOrThrow({ where: { slug } })).id;
  const coachId = async (key: string) => (await prisma.user.findUniqueOrThrow({ where: { tenantId_email: { tenantId, email: `${key}@${slug}.example.test` } } })).id;
  return { tenantId, coachId };
}

async function createPlan(
  prisma: PrismaClient,
  ctx: { tenantId: string },
  slug: string,
  def: { key: string; coachId: string; title: string; description: string; sportSlug: string; cadence: "DAILY" | "WEEKLY" | "MONTHLY"; days: DayDef[]; createdDaysAgo: number },
  today: string,
) {
  const P = WE(slug);
  const sources = [...new Set(def.days.flatMap((d) => d.items.map((i) => i.ex)))];
  const exRows = await prisma.exercise.findMany({ where: { tenantId: ctx.tenantId, sourceId: { in: sources } }, select: { id: true, sourceId: true, metricType: true } });
  const ex = new Map(exRows.map((e) => [e.sourceId, e]));
  const planId = `${P}plan-${def.key}`;
  await prisma.workoutPlan.create({
    data: { id: planId, tenantId: ctx.tenantId, coachId: def.coachId, title: def.title, description: def.description, cadence: def.cadence, sportSlug: def.sportSlug, status: "ACTIVE", createdAt: istAt(addDays(today, -def.createdDaysAgo), "10:00") },
  });
  const days: { dayIndex: number; id: string; items: { id: string; def: ItemDef; exerciseId: string; sourceId: string; metric: string }[] }[] = [];
  for (const d of def.days) {
    const dayId = `${P}day-${def.key}-${d.dayIndex}`;
    await prisma.workoutPlanDay.create({ data: { id: dayId, tenantId: ctx.tenantId, planId, dayIndex: d.dayIndex, title: d.title } });
    const items: (typeof days)[number]["items"] = [];
    for (const [pos, it] of d.items.entries()) {
      const e = ex.get(it.ex);
      if (!e) throw new Error(`Seed exercise "${it.ex}" is not in the catalog for ${slug}`);
      const id = `${P}item-${def.key}-${d.dayIndex}-${pos + 1}`;
      await prisma.workoutPlanItem.create({
        data: {
          id, tenantId: ctx.tenantId, dayId, exerciseId: e.id, position: pos + 1, sets: it.sets ?? null, reps: it.reps ?? null, durationSeconds: it.dur ?? null, restSeconds: it.rest ?? null,
          supersetGroup: it.group ?? null, rounds: it.rounds ?? null, targetWeightKg: it.target ?? null, targetDistanceMeters: it.meters ?? null,
        },
      });
      items.push({ id, def: it, exerciseId: e.id, sourceId: it.ex, metric: e.metricType });
    }
    days.push({ dayIndex: d.dayIndex, id: dayId, items });
  }
  return { planId, days };
}

type PlanMade = Awaited<ReturnType<typeof createPlan>>;

/** Assignment, dated completed logs and their sets for one member on a plan. Returns the number of logs. */
async function logRun(
  prisma: PrismaClient,
  ctx: { tenantId: string },
  slug: string,
  a: { key: string; plan: PlanMade; cadence: "DAILY" | "WEEKLY" | "MONTHLY"; memberKey: string; coachId: string; startDaysAgo: number; endDaysAgo: number | null; status?: "ENDED"; adherence: number; scale: number; note?: string },
  today: string,
) {
  const P = WE(slug);
  const memberId = `seed-${slug}-member-${a.memberKey}`;
  const start = addDays(today, -a.startDaysAgo);
  const end = a.endDaysAgo === null ? null : addDays(today, -a.endDaysAgo);
  const asgId = `${P}asg-${a.key}`;
  await prisma.planAssignment.create({
    data: { id: asgId, tenantId: ctx.tenantId, planId: a.plan.planId, memberId, assignedById: a.coachId, status: a.status ?? "ACTIVE", startsOn: dbDate(start), endsOn: end ? dbDate(end) : null, planVersion: 1, note: a.note ?? null, createdAt: istAt(start, "09:00") },
  });
  await prisma.memberUpdate.create({
    data: { id: `${P}upd-${a.key}`, tenantId: ctx.tenantId, memberId, actorId: a.coachId, kind: "PLAN_ASSIGNED", entityType: "assignment", entityId: asgId, params: { planTitle: (await prisma.workoutPlan.findUniqueOrThrow({ where: { id: a.plan.planId } })).title, startsOn: start }, createdAt: istAt(start, "09:00"), readAt: istAt(start, "12:00") },
  });
  const sched = expandSchedule(
    { status: "active", startsOn: start, endsOn: end ?? today },
    { cadence: a.cadence.toLowerCase() as "daily" | "weekly" | "monthly", days: a.plan.days.map((d) => ({ dayIndex: d.dayIndex, items: d.items.map((i) => ({ id: i.id })) })) },
    start,
    end ?? today,
  );
  const span = Math.max(1, daysBetween(start, end ?? today));
  const byDay = new Map(a.plan.days.map((d) => [d.dayIndex, d]));
  const logs: Prisma.WorkoutLogCreateManyInput[] = [];
  const sets: Prisma.WorkoutSetCreateManyInput[] = [];
  for (const sd of sched) {
    if (sd.date >= today) continue; // today's items stay open for the demo customer
    if (rnd(slug, a.key, sd.date, "day") > a.adherence) continue;
    const day = byDay.get(sd.dayIndex)!;
    const progress = daysBetween(start, sd.date) / span;
    for (const [pos, it] of day.items.entries()) {
      const logId = `${P}log-${a.key}-${it.id.slice(P.length)}-${sd.date}`;
      const at = new Date(istAt(sd.date, "07:00").getTime() + pos * 9 * 60_000);
      const specs = genSets({
        seed: `${slug}|${a.key}|${sd.date}`, exercise: it.sourceId, sets: it.def.sets ?? 1, reps: it.def.reps ?? null, dur: it.def.dur ?? null, target: it.def.target ?? null,
        meters: it.def.meters ?? null, progress, scale: a.scale, metric: (it.metric === "CHECKLIST" ? "REPS" : it.metric) as Gen["metric"],
      });
      const totals = deriveLogTotals(specs.map(toLike));
      logs.push({
        id: logId, tenantId: ctx.tenantId, assignmentId: asgId, planItemId: it.id, memberId, scheduledFor: dbDate(sd.date), status: "COMPLETED", startedAt: at,
        completedAt: new Date(at.getTime() + (totals.actualDurationSeconds ?? 240) * 1000), ...totals, note: rnd(slug, logId, "note") < 0.05 ? "Sample note: felt good today." : null, clientId: logId, recordedById: a.coachId,
      });
      for (const s of specs) {
        sets.push({ id: `${logId}-s${s.setNumber}`, tenantId: ctx.tenantId, logId, clientId: `${logId}-s${s.setNumber}`, completedAt: new Date(at.getTime() + s.setNumber * 90_000), ...s });
      }
    }
  }
  for (let i = 0; i < logs.length; i += 1000) await prisma.workoutLog.createMany({ data: logs.slice(i, i + 1000) });
  for (let i = 0; i < sets.length; i += 1000) await prisma.workoutSet.createMany({ data: sets.slice(i, i + 1000) });
  return { logs: logs.length, sets: sets.length };
}

// ---- gym ----

async function seedGym(prisma: PrismaClient, slug: string, today: string) {
  const ctx = await loadContext(prisma, slug);
  const P = WE(slug);
  const c1 = await ctx.coachId("c1");
  const counts = { logs: 0, sets: 0, plans: 0 };

  // Two extra sports for an arena-style gym (badminton courts, a pool).
  for (const [key, name] of [["badminton", "Badminton"], ["swimming", "Swimming"]] as const) {
    await prisma.sport.create({ data: { id: `${P}sport-${key}`, tenantId: ctx.tenantId, slug: key, name } });
  }

  // 1. A finished strength block (about six months ago to two months ago) with a superset day.
  const found = await createPlan(prisma, ctx, slug, {
    key: "foundations", coachId: c1, title: "Strength Foundations (finished block)", sportSlug: "gym", cadence: "WEEKLY", createdDaysAgo: 245,
    description: "A 24-week strength block: squat, press and pull patterns with a bench and row superset.",
    days: [
      { dayIndex: 1, title: "Squat and push", items: [
        { ex: "Barbell_Squat", sets: 4, reps: 8, rest: 90, target: 40 },
        { ex: "Barbell_Bench_Press_-_Medium_Grip", sets: 3, reps: 8, target: 30, group: "A", rounds: 3 },
        { ex: "Bent_Over_Barbell_Row", sets: 3, reps: 10, target: 30, group: "A", rounds: 3 },
        { ex: "Plank", sets: 3, dur: 40, rest: 45 },
      ] },
      { dayIndex: 3, title: "Hinge and press", items: [
        { ex: "Barbell_Deadlift", sets: 3, reps: 5, rest: 120, target: 50 },
        { ex: "Dumbbell_Shoulder_Press", sets: 3, reps: 10, target: 10, group: "A", rounds: 3 },
        { ex: "Wide-Grip_Lat_Pulldown", sets: 3, reps: 10, target: 35, group: "A", rounds: 3 },
      ] },
      { dayIndex: 5, title: "Legs and pull", items: [
        { ex: "Goblet_Squat", sets: 3, reps: 12, rest: 60, target: 14 },
        { ex: "Dumbbell_Bench_Press", sets: 3, reps: 10, target: 12 },
        { ex: "Seated_Cable_Rows", sets: 3, reps: 12, target: 30 },
      ] },
    ],
  }, today);
  counts.plans++;
  const run1 = await logRun(prisma, ctx, slug, { key: "found-m1", plan: found, cadence: "WEEKLY", memberKey: "m1", coachId: c1, startDaysAgo: 240, endDaysAgo: 61, status: "ENDED", adherence: 0.82, scale: 1, note: "First strength block." }, today);
  counts.logs += run1.logs; counts.sets += run1.sets;

  // 2. Sets for the current full-body logs of two members (so the last two months continue the chart).
  const scales: Record<string, number> = { m1: 1.35, m2: 1.05 };
  for (const [mk, scale] of Object.entries(scales)) {
    const memberId = `seed-${slug}-member-${mk}`;
    const existing = await prisma.workoutLog.findMany({
      where: { tenantId: ctx.tenantId, memberId, status: "COMPLETED", id: { startsWith: `seed-${slug}-r-log-` } },
      include: { planItem: { include: { exercise: { select: { sourceId: true, metricType: true } } } } },
      orderBy: { scheduledFor: "asc" },
    });
    const first = existing[0] ? existing[0].scheduledFor.toISOString().slice(0, 10) : today;
    const rows: Prisma.WorkoutSetCreateManyInput[] = [];
    for (const l of existing) {
      const date = l.scheduledFor.toISOString().slice(0, 10);
      const specs = genSets({
        seed: `${slug}|cur|${mk}|${date}`, exercise: l.planItem.exercise.sourceId, sets: l.planItem.sets ?? 1, reps: l.planItem.reps, dur: l.planItem.durationSeconds, target: null, meters: null,
        progress: daysBetween(first, date) / Math.max(1, daysBetween(first, today)), scale, metric: l.planItem.exercise.metricType === "WEIGHT_REPS" ? "WEIGHT_REPS" : "REPS",
      });
      for (const s of specs) {
        rows.push({ id: `seed-${slug}-r-${l.id.slice(`seed-${slug}-r-`.length)}-s${s.setNumber}`, tenantId: ctx.tenantId, logId: l.id, clientId: `${l.id}-s${s.setNumber}`, completedAt: new Date((l.startedAt ?? l.createdAt).getTime() + s.setNumber * 90_000), ...s });
      }
    }
    for (let i = 0; i < rows.length; i += 1000) await prisma.workoutSet.createMany({ data: rows.slice(i, i + 1000) });
    counts.sets += rows.length;
  }

  // 3. Badminton drills and a swimming set, with results that fit each metric.
  const bad = await createPlan(prisma, ctx, slug, {
    key: "badminton", coachId: c1, title: "Badminton Footwork and Smash Drills", sportSlug: "badminton", cadence: "WEEKLY", createdDaysAgo: 40,
    description: "Footwork, smash accuracy and net control twice a week.",
    days: [
      { dayIndex: 2, title: "Footwork and smash", items: [
        { ex: "badminton-shadow-footwork", sets: 4, dur: 60, rest: 30 },
        { ex: "badminton-split-step", sets: 3, dur: 40, rest: 20 },
        { ex: "badminton-smash-drill", sets: 3, reps: 20, group: "A", rounds: 3 },
        { ex: "badminton-net-drops", sets: 3, reps: 12, group: "A", rounds: 3 },
      ] },
      { dayIndex: 4, title: "Clears and control", items: [
        { ex: "badminton-clear-drill", sets: 3, reps: 15, rest: 30 },
        { ex: "badminton-net-drops", sets: 3, reps: 12, rest: 30 },
        { ex: "badminton-smash-drill", sets: 3, reps: 20, rest: 45 },
      ] },
    ],
  }, today);
  const swim = await createPlan(prisma, ctx, slug, {
    key: "swim", coachId: c1, title: "Swim Endurance Set", sportSlug: "swimming", cadence: "WEEKLY", createdDaysAgo: 50,
    description: "Steady freestyle, kick and pull sets to build endurance.",
    days: [
      { dayIndex: 1, title: "Freestyle and kick", items: [
        { ex: "swim-freestyle-laps", sets: 6, meters: 50, rest: 30 },
        { ex: "swim-kick-set", sets: 4, meters: 25, rest: 20 },
        { ex: "swim-treading-water", sets: 2, dur: 60, rest: 30 },
      ] },
      { dayIndex: 4, title: "Pull and breathing", items: [
        { ex: "swim-pull-set", sets: 4, meters: 50, rest: 30 },
        { ex: "swim-breathing-drill", sets: 3, reps: 8, rest: 20 },
        { ex: "swim-freestyle-laps", sets: 4, meters: 50, rest: 30 },
      ] },
    ],
  }, today);
  counts.plans += 2;
  const r2 = await logRun(prisma, ctx, slug, { key: "bad-m3", plan: bad, cadence: "WEEKLY", memberKey: "m3", coachId: c1, startDaysAgo: 35, endDaysAgo: null, adherence: 0.85, scale: 1, note: "Court drills before the weekend." }, today);
  const r3 = await logRun(prisma, ctx, slug, { key: "swim-m4", plan: swim, cadence: "WEEKLY", memberKey: "m4", coachId: c1, startDaysAgo: 49, endDaysAgo: null, adherence: 0.8, scale: 1 }, today);
  counts.logs += r2.logs + r3.logs; counts.sets += r2.sets + r3.sets;
  return counts;
}

// ---- karate ----

const BELT_SKILLS: Record<string, string[]> = {
  Yellow: ["Ready stance and bow", "Front stance with a straight punch", "Low block", "Front kick with control", "First kata, steps one to ten", "Belt etiquette and counting in Japanese"],
  Orange: ["Back stance with a knife-hand block", "Reverse punch from a front stance", "Side kick, slow and controlled", "Second kata, full pattern", "One-step sparring drill", "Balance on one leg for ten seconds"],
  Green: ["Horse stance for one minute", "Combination: block, punch, kick", "Third kata, full pattern", "Flexibility check: side split reach", "Partner distance drill", "Short talk: why we train"],
};

async function seedKarate(prisma: PrismaClient, slug: string, today: string) {
  const ctx = await loadContext(prisma, slug);
  const P = WE(slug);
  const c1 = await ctx.coachId("c1");
  const counts = { plans: 0, summaries: 0, signOffs: 0, checklists: 0 };

  // 1. The class workout plan: a kihon circuit with a punch and block superset.
  const kihon = await createPlan(prisma, ctx, slug, {
    key: "kihon", coachId: c1, title: "Kids Class: Kihon Circuit", sportSlug: "karate", cadence: "WEEKLY", createdDaysAgo: 30,
    description: "A class workout: stance, punch and block superset, kicks and a slow kata walk-through.",
    days: [{ dayIndex: 1, title: "Kihon circuit", items: [
      { ex: "karate-ready-stance", sets: 1, dur: 60 },
      { ex: "karate-straight-punch", sets: 3, reps: 10, group: "A", rounds: 3 },
      { ex: "karate-block-set", sets: 3, reps: 8, group: "A", rounds: 3 },
      { ex: "karate-front-kick", sets: 3, reps: 8, rest: 30 },
      { ex: "karate-kata-walkthrough", sets: 1, reps: 1 },
    ] }],
  }, today);
  counts.plans++;
  const planDayId = kihon.days[0].id;

  // 2. Attach it to the two latest completed kids classes and publish the after-class summaries
  //    through the real code path (present, absent and excused members all get their update).
  const batchId = `seed-${slug}-batch-kids`;
  const db = forTenant(prisma, ctx.tenantId);
  // Prefer recent classes where somebody was absent or excused, so the catch-up wording has data to show.
  const recent = await prisma.session.findMany({
    where: { tenantId: ctx.tenantId, batchId, status: "COMPLETED", startsAt: { lt: new Date(istAt(today, "23:59")) } },
    orderBy: { startsAt: "desc" },
    take: 10,
    select: { id: true, attendance: { select: { status: true } } },
  });
  const missed = (x: (typeof recent)[number]) => x.attendance.some((a) => a.status !== "PRESENT") && x.attendance.some((a) => a.status === "PRESENT");
  const done = [...recent.filter(missed).slice(0, 2), ...recent.filter((x) => !missed(x))].slice(0, 3);
  const principal = { userId: c1, tenantId: ctx.tenantId, role: "coach" as const };
  const notes = [
    { coachNote: "Sample note: sharp punches today, and the group kept a steady rhythm in the block drill.", homePractice: "Ten straight punches and eight low blocks, slowly, in front of a mirror. Hold ready stance for one minute." },
    { coachNote: "Sample note: good effort on the front kick. Next class we start the second half of the kata.", homePractice: "Five front kicks on each leg, holding a wall for balance if needed." },
  ];
  for (const [i, s] of done.slice(0, 2).entries()) {
    await prisma.session.update({ where: { id: s.id }, data: { planDayId } });
    const row = await prisma.session.findFirstOrThrow({ where: { id: s.id }, include: sessionInclude });
    await publishSummaryTx(db as never, principal, row, notes[i], row.completedAt ?? row.endsAt);
    await prisma.memberUpdate.updateMany({ where: { tenantId: ctx.tenantId, entityType: "class_summary", entityId: s.id }, data: { createdAt: new Date((row.completedAt ?? row.endsAt).getTime() + 10 * 60_000) } });
    counts.summaries++;
  }
  // The class before those had a workout attached but no summary yet; the next scheduled class has one too.
  if (done[2]) await prisma.session.update({ where: { id: done[2].id }, data: { planDayId } });
  const next = await prisma.session.findFirst({ where: { tenantId: ctx.tenantId, batchId, status: "SCHEDULED", startsAt: { gt: new Date() } }, orderBy: { startsAt: "asc" }, select: { id: true } });
  if (next) await prisma.session.update({ where: { id: next.id }, data: { planDayId } });

  // 3. Belt checklists for Yellow, Orange and Green with partial sign-offs.
  const levels = await prisma.level.findMany({ where: { tenantId: ctx.tenantId, sport: { slug: "karate" } }, orderBy: { rank: "asc" } });
  const sport = await prisma.sport.findFirstOrThrow({ where: { tenantId: ctx.tenantId, slug: "karate" } });
  const itemIds: Record<string, string[]> = {};
  for (const [order, name] of Object.keys(BELT_SKILLS).entries()) {
    const level = levels.find((l) => l.name === name);
    if (!level) continue;
    const cid = `${P}chk-${name.toLowerCase()}`;
    await prisma.skillChecklist.create({ data: { id: cid, tenantId: ctx.tenantId, sportId: sport.id, levelId: level.id, title: `${name} belt skills`, sortOrder: order + 1 } });
    itemIds[name] = [];
    for (const [i, title] of BELT_SKILLS[name].entries()) {
      const iid = `${P}skill-${name.toLowerCase()}-${i + 1}`;
      await prisma.skillItem.create({ data: { id: iid, tenantId: ctx.tenantId, checklistId: cid, title, sortOrder: i + 1 } });
      itemIds[name].push(iid);
    }
    counts.checklists++;
  }
  // Who is signed off on what (member key, belt, how many skills, ratings cycle).
  const plan: [string, string, number][] = [["k1", "Yellow", 3], ["k2", "Yellow", 5], ["k3", "Orange", 1], ["k5", "Green", 2], ["k6", "Yellow", 4]];
  for (const [mk, belt, n] of plan) {
    for (const [i, itemId] of (itemIds[belt] ?? []).slice(0, n).entries()) {
      const rating = 2 + Math.floor(rnd(slug, mk, belt, i) * 3); // 2..4
      await prisma.skillSignOff.create({
        data: {
          id: `${P}so-${mk}-${belt.toLowerCase()}-${i + 1}`, tenantId: ctx.tenantId, memberId: `seed-${slug}-member-${mk}`, skillItemId: itemId, rating,
          note: i === 0 ? "Sample note: clean and confident." : null, signedOffById: c1, signedOffAt: istAt(addDays(today, -(40 - i * 7)), "18:30"),
        },
      });
      counts.signOffs++;
    }
  }
  return counts;
}

export type WorkoutEngineCounts = Record<string, number>;

/** Seeds the workout engine layer for one demo tenant (no-op for tenants without a pack). */
export async function seedWorkoutEngine(prisma: PrismaClient, slug: string, today: string): Promise<WorkoutEngineCounts> {
  if (slug === "demo-gym") return seedGym(prisma, slug, today);
  if (slug === "demo-karate") return seedKarate(prisma, slug, today);
  return {};
}
