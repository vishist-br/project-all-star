// Configuration for the rich demo layer (STAR-63). All people are synthetic ("Sample ..."),
// all emails are *.example.test. Only shapes live here (who is consistent, which plan has
// which exercises); concrete dates are computed relative to the seed run date in rich.ts.

export type Archetype = "consistent" | "steady" | "sporadic" | "lapsed" | "new" | "leaver";

export type RichExtra = {
  key: string;
  name: string;
  birthYear: number;
  feeStatus: "PAID" | "DUE" | "OVERDUE" | "WAIVED";
  batches: string[];
  joinedDaysAgo: number;
  leftDaysAgo?: number;
  arch: Archetype;
  level?: string;
  guardianKey?: string; // kids only
  guardianName?: string;
};

export type PlanItemDef = { ex: string; sets?: number; reps?: number; dur?: number; rest?: number; notes?: string };
export type PlanDayDef = { dayIndex: number; title: string; items: PlanItemDef[] };
export type PlanDef = {
  key: string;
  coach: string;
  title: string;
  description: string;
  cadence: "DAILY" | "WEEKLY" | "MONTHLY";
  sportSlug: string;
  status?: "ACTIVE" | "DRAFT" | "ARCHIVED";
  version?: number;
  days: PlanDayDef[];
};
export type AssignmentDef = {
  plan: string;
  member: string;
  daysAgo: number; // startsOn = today - daysAgo
  status?: "PAUSED" | "ENDED";
  endedDaysAgo?: number; // ENDED: endsOn; PAUSED: paused since
  note?: string;
};
export type CustomGoal = { title: string; start: number; target: number; unit: string };

export type RichTenant = {
  slug: string;
  settings: { cancelWindowMinutes: number; waitlistEnabled: boolean; showMissedSessionCost: boolean };
  /** Members that get every kind of data (the demo customer logins). */
  demoCustomers: string[];
  baseArch: Record<string, Archetype>;
  baseJoinedDaysAgo: Record<string, number>;
  extras: RichExtra[];
  /** Levels to add for sports that have none (gym, yoga). */
  levels: { sportSlug: string; names: string[] }[];
  plans: PlanDef[];
  assignments: AssignmentDef[];
  customGoals: CustomGoal[];
  /** Weekly open slots a coach offers beyond their batches: coach -> [weekday, start, end]. */
  extraAvailability: Record<string, [number, string, string][]>;
};

const it = (ex: string, sets?: number, reps?: number, dur?: number, rest?: number, notes?: string): PlanItemDef => ({
  ex, sets, reps, dur, rest, notes,
});
const day = (dayIndex: number, title: string, items: PlanItemDef[]): PlanDayDef => ({ dayIndex, title, items });
/** Rotate templates across a list of day indexes (monthly plans). */
const rotate = (indexes: number[], templates: { title: string; items: PlanItemDef[] }[]): PlanDayDef[] =>
  indexes.map((d, i) => day(d, templates[i % templates.length].title, templates[i % templates.length].items));

const MONTH_DAYS = [2, 4, 6, 9, 11, 13, 16, 18, 20, 23, 25, 27, 30];

const karate: RichTenant = {
  slug: "demo-karate",
  settings: { cancelWindowMinutes: 240, waitlistEnabled: true, showMissedSessionCost: false },
  demoCustomers: ["k1", "a1"],
  baseArch: { k1: "consistent", k2: "steady", k3: "sporadic", k4: "lapsed", k5: "consistent", k6: "steady", a1: "consistent", a2: "sporadic" },
  baseJoinedDaysAgo: { k1: 250, k2: 230, k3: 200, k4: 175, k5: 140, k6: 110, a1: 260, a2: 90 },
  extras: [
    { key: "k7", name: "Sample Kid 07", birthYear: 2016, feeStatus: "PAID", batches: ["kids"], joinedDaysAgo: 9, arch: "new", level: "White", guardianKey: "g7", guardianName: "Sample Parent 07" },
    { key: "k8", name: "Sample Kid 08", birthYear: 2015, feeStatus: "OVERDUE", batches: ["kids"], joinedDaysAgo: 200, leftDaysAgo: 38, arch: "leaver", level: "White", guardianKey: "g8", guardianName: "Sample Parent 08" },
    { key: "k9", name: "Sample Kid 09", birthYear: 2017, feeStatus: "PAID", batches: ["kids"], joinedDaysAgo: 110, arch: "steady", level: "Yellow", guardianKey: "g9", guardianName: "Sample Parent 09" },
    { key: "a3", name: "Sample Adult 03", birthYear: 1991, feeStatus: "PAID", batches: ["adults"], joinedDaysAgo: 150, arch: "consistent", level: "Orange" },
    { key: "a4", name: "Sample Adult 04", birthYear: 1996, feeStatus: "PAID", batches: ["adults"], joinedDaysAgo: 16, arch: "new", level: "White" },
    { key: "a5", name: "Sample Adult 05", birthYear: 1984, feeStatus: "PAID", batches: ["adults"], joinedDaysAgo: 230, leftDaysAgo: 21, arch: "leaver", level: "Yellow" },
  ],
  levels: [],
  plans: [
    {
      key: "kids-daily", coach: "c1", title: "Kids Daily Basics", cadence: "DAILY", sportSlug: "karate",
      description: "Ten minutes of stance, punch and block practice at home between classes.",
      days: [day(1, "Daily basics", [
        it("karate-ready-stance", 1, undefined, 60, 15),
        it("karate-front-stance-walk", 2, 10, undefined, 20),
        it("karate-straight-punch", 3, 10, undefined, 30),
        it("karate-block-set", 2, 8, undefined, 30),
        it("karate-cooldown-stretch", 1, undefined, 120),
      ])],
    },
    {
      key: "kids-weekly", coach: "c1", title: "Kids Weekly Kata Practice", cadence: "WEEKLY", sportSlug: "karate", version: 2,
      description: "Three short practice days per week that build towards the next belt test.",
      days: [
        day(2, "Kata and balance", [it("karate-kata-walkthrough", 3, 1, undefined, 30), it("karate-front-kick", 3, 8, undefined, 30), it("karate-squat-hold", 3, undefined, 30, 30)]),
        day(4, "Stances and kicks", [it("karate-hip-mobility", 2, 10), it("karate-front-stance-walk", 3, 10, undefined, 30), it("karate-front-kick", 3, 10, undefined, 30)]),
        day(6, "Weekend recap", [it("karate-skipping-rope", 2, undefined, 120, 45), it("karate-straight-punch", 3, 12, undefined, 30), it("karate-cooldown-stretch", 1, undefined, 120)]),
      ],
    },
    {
      key: "adult-monthly", coach: "c2", title: "Adult Monthly Conditioning", cadence: "MONTHLY", sportSlug: "karate",
      description: "A month of alternating conditioning and technique days for the adult batch.",
      days: rotate(MONTH_DAYS, [
        { title: "Conditioning A", items: [it("karate-skipping-rope", 3, undefined, 150, 45), it("karate-squat-hold", 3, undefined, 45, 30), it("karate-core-plank", 3, undefined, 45, 30), it("Pushups", 3, 12, undefined, 45), it("karate-cooldown-stretch", 1, undefined, 120)] },
        { title: "Technique B", items: [it("karate-hip-mobility", 2, 10), it("karate-front-kick", 4, 10, undefined, 30), it("karate-block-set", 3, 10, undefined, 30), it("karate-straight-punch", 4, 12, undefined, 30)] },
      ]),
    },
    {
      key: "adult-daily", coach: "c2", title: "Adult Daily Mobility", cadence: "DAILY", sportSlug: "karate",
      description: "A short daily mobility and core routine to keep hips and legs loose.",
      days: [day(1, "Daily mobility", [it("karate-hip-mobility", 2, 10), it("karate-squat-hold", 2, undefined, 30, 20), it("karate-core-plank", 2, undefined, 40, 30), it("karate-cooldown-stretch", 1, undefined, 90)])],
    },
    {
      key: "belt-prep", coach: "c2", title: "Belt Test Prep (draft)", cadence: "WEEKLY", sportSlug: "karate", status: "DRAFT",
      description: "Work in progress: revision of kata and basics before a belt test.",
      days: [day(3, "Revision", [it("karate-kata-walkthrough", 3, 2), it("karate-block-set", 3, 10), it("karate-front-kick", 3, 10)])],
    },
    {
      key: "old-conditioning", coach: "c2", title: "Beginner Conditioning (archived)", cadence: "WEEKLY", sportSlug: "karate", status: "ARCHIVED",
      description: "Replaced by the monthly conditioning plan.",
      days: [
        day(1, "Core", [it("karate-core-plank", 3, undefined, 30, 30), it("karate-squat-hold", 3, undefined, 30, 30)]),
        day(5, "Cardio", [it("karate-skipping-rope", 3, undefined, 120, 45), it("karate-cooldown-stretch", 1, undefined, 120)]),
      ],
    },
  ],
  assignments: [
    { plan: "kids-daily", member: "k1", daysAgo: 49 },
    { plan: "kids-daily", member: "k2", daysAgo: 42 },
    { plan: "kids-daily", member: "k4", daysAgo: 56 },
    { plan: "kids-daily", member: "k5", daysAgo: 35 },
    { plan: "kids-daily", member: "k7", daysAgo: 7, note: "Welcome to the dojo. Start with the daily basics." },
    { plan: "kids-weekly", member: "k3", daysAgo: 42 },
    { plan: "kids-weekly", member: "k6", daysAgo: 49, status: "PAUSED", endedDaysAgo: 14, note: "Paused for exams." },
    { plan: "adult-monthly", member: "a1", daysAgo: 56 },
    { plan: "adult-daily", member: "a1", daysAgo: 30 },
    { plan: "adult-monthly", member: "a2", daysAgo: 21 },
    { plan: "adult-monthly", member: "a4", daysAgo: 14 },
    { plan: "old-conditioning", member: "a2", daysAgo: 70, status: "ENDED", endedDaysAgo: 22 },
    { plan: "kids-daily", member: "k8", daysAgo: 60, status: "ENDED", endedDaysAgo: 38 },
  ],
  customGoals: [
    { title: "Hold horse stance for 2 minutes", start: 30, target: 120, unit: "seconds" },
    { title: "Do 20 push-ups in a row", start: 8, target: 20, unit: "reps" },
    { title: "Skip 100 times without a break", start: 40, target: 100, unit: "skips" },
  ],
  extraAvailability: { c1: [[6, "09:00", "11:00"]], c2: [[6, "10:00", "12:00"], [7, "08:00", "10:00"]] },
};

const gym: RichTenant = {
  slug: "demo-gym",
  settings: { cancelWindowMinutes: 120, waitlistEnabled: true, showMissedSessionCost: true },
  demoCustomers: ["m1"],
  baseArch: { m1: "consistent", m2: "steady", m3: "sporadic", m4: "steady", m5: "lapsed", m6: "consistent", m7: "sporadic", m8: "steady" },
  baseJoinedDaysAgo: { m1: 270, m2: 240, m3: 210, m4: 185, m5: 160, m6: 130, m7: 100, m8: 75 },
  extras: [
    { key: "m9", name: "Sample Member 09", birthYear: 1994, feeStatus: "PAID", batches: ["morning"], joinedDaysAgo: 10, arch: "new" },
    { key: "m10", name: "Sample Member 10", birthYear: 1999, feeStatus: "DUE", batches: ["evening"], joinedDaysAgo: 19, arch: "new" },
    { key: "m11", name: "Sample Member 11", birthYear: 1982, feeStatus: "OVERDUE", batches: ["evening"], joinedDaysAgo: 210, leftDaysAgo: 28, arch: "leaver" },
    { key: "m12", name: "Sample Member 12", birthYear: 1990, feeStatus: "PAID", batches: ["morning"], joinedDaysAgo: 180, leftDaysAgo: 63, arch: "leaver" },
    { key: "m13", name: "Sample Member 13", birthYear: 1987, feeStatus: "PAID", batches: ["morning"], joinedDaysAgo: 120, arch: "consistent" },
    { key: "m14", name: "Sample Member 14", birthYear: 1979, feeStatus: "DUE", batches: ["evening"], joinedDaysAgo: 240, arch: "steady" },
    { key: "m15", name: "Sample Member 15", birthYear: 1997, feeStatus: "PAID", batches: ["evening"], joinedDaysAgo: 75, arch: "sporadic" },
  ],
  levels: [{ sportSlug: "gym", names: ["Foundation", "Builder", "Strong"] }],
  plans: [
    {
      key: "full-body", coach: "c1", title: "Full Body Strength (3 days)", cadence: "WEEKLY", sportSlug: "gym", version: 2,
      description: "Three full-body sessions a week: squat, press and pull patterns.",
      days: [
        day(1, "Squat and push", [it("Barbell_Squat", 4, 8, undefined, 90), it("Barbell_Bench_Press_-_Medium_Grip", 4, 8, undefined, 90), it("Bent_Over_Barbell_Row", 3, 10, undefined, 75), it("Plank", 3, undefined, 45, 45)]),
        day(3, "Hinge and press", [it("Barbell_Deadlift", 3, 5, undefined, 120), it("Dumbbell_Shoulder_Press", 3, 10, undefined, 75), it("Wide-Grip_Lat_Pulldown", 3, 10, undefined, 75), it("Crunches", 3, 15, undefined, 45)]),
        day(5, "Legs and pull", [it("Goblet_Squat", 3, 12, undefined, 60), it("Dumbbell_Bench_Press", 3, 10, undefined, 75), it("Seated_Cable_Rows", 3, 12, undefined, 60), it("Side_Bridge", 3, undefined, 30, 30)]),
      ],
    },
    {
      key: "mobility", coach: "c1", title: "Daily Mobility 10 min", cadence: "DAILY", sportSlug: "gym",
      description: "A short mobility and core routine for rest days and mornings.",
      days: [day(1, "Mobility", [it("Cat_Stretch", 1, undefined, 60), it("Bodyweight_Squat", 2, 12, undefined, 30), it("Childs_Pose", 1, undefined, 60), it("Plank", 2, undefined, 40, 30)])],
    },
    {
      key: "block", coach: "c2", title: "Four-Week Strength Block", cadence: "MONTHLY", sportSlug: "gym",
      description: "One-to-one training block with three rotating session templates.",
      days: rotate(MONTH_DAYS, [
        { title: "Lower body", items: [it("Barbell_Squat", 4, 6, undefined, 120), it("Romanian_Deadlift", 3, 8, undefined, 90), it("Leg_Press", 3, 12, undefined, 75), it("Standing_Calf_Raises", 3, 15, undefined, 45)] },
        { title: "Upper push", items: [it("Barbell_Bench_Press_-_Medium_Grip", 4, 6, undefined, 120), it("Standing_Military_Press", 3, 8, undefined, 90), it("Dumbbell_Flyes", 3, 12, undefined, 60), it("Triceps_Pushdown", 3, 12, undefined, 45)] },
        { title: "Upper pull and core", items: [it("Pullups", 4, 6, undefined, 90), it("Seated_Cable_Rows", 3, 10, undefined, 75), it("Barbell_Curl", 3, 10, undefined, 60), it("Hanging_Leg_Raise", 3, 10, undefined, 60)] },
      ]),
    },
    {
      key: "circuit", coach: "c2", title: "Beginner Circuit (archived)", cadence: "WEEKLY", sportSlug: "gym", status: "ARCHIVED",
      description: "Older beginner circuit, kept for history.",
      days: [
        day(2, "Circuit", [it("Bodyweight_Squat", 3, 15, undefined, 30), it("Pushups", 3, 10, undefined, 30), it("Mountain_Climbers", 3, undefined, 40, 30)]),
        day(6, "Circuit 2", [it("Dumbbell_Lunges", 3, 10, undefined, 45), it("Crunches", 3, 15, undefined, 30)]),
      ],
    },
  ],
  assignments: [
    ...["m1", "m2", "m3", "m4"].map((m, i) => ({ plan: "full-body", member: m, daysAgo: 56 - i * 6 })),
    { plan: "full-body", member: "m9", daysAgo: 8 },
    { plan: "full-body", member: "m13", daysAgo: 30 },
    { plan: "full-body", member: "m14", daysAgo: 40 },
    { plan: "mobility", member: "m1", daysAgo: 21 },
    { plan: "mobility", member: "m7", daysAgo: 35 },
    { plan: "mobility", member: "m8", daysAgo: 28, status: "PAUSED" as const, endedDaysAgo: 10, note: "Paused while travelling." },
    { plan: "mobility", member: "m10", daysAgo: 12 },
    { plan: "block", member: "m5", daysAgo: 49 },
    { plan: "block", member: "m6", daysAgo: 42 },
    { plan: "circuit", member: "m11", daysAgo: 60, status: "ENDED" as const, endedDaysAgo: 28 },
    { plan: "circuit", member: "m3", daysAgo: 80, status: "ENDED" as const, endedDaysAgo: 57 },
  ],
  customGoals: [
    { title: "Squat 60 kg for 5 reps", start: 40, target: 60, unit: "kg" },
    { title: "Reduce waist from 92 to 86 cm", start: 92, target: 86, unit: "cm" },
    { title: "Hold a plank for 90 seconds", start: 35, target: 90, unit: "seconds" },
  ],
  extraAvailability: { c2: [[1, "17:00", "19:00"]] },
};

const studio: RichTenant = {
  slug: "demo-studio",
  settings: { cancelWindowMinutes: 60, waitlistEnabled: true, showMissedSessionCost: false },
  demoCustomers: ["m1"],
  baseArch: { m1: "consistent", m2: "sporadic", m3: "steady", m4: "consistent", m5: "lapsed", m6: "steady", m7: "steady", m8: "consistent" },
  baseJoinedDaysAgo: { m1: 255, m2: 225, m3: 195, m4: 170, m5: 145, m6: 115, m7: 85, m8: 70 },
  extras: [
    { key: "m9", name: "Sample Member 09", birthYear: 1992, feeStatus: "PAID", batches: ["yoga"], joinedDaysAgo: 8, arch: "new" },
    { key: "m10", name: "Sample Member 10", birthYear: 1998, feeStatus: "PAID", batches: ["dance"], joinedDaysAgo: 18, arch: "new" },
    { key: "m11", name: "Sample Member 11", birthYear: 1986, feeStatus: "PAID", batches: ["dance"], joinedDaysAgo: 190, leftDaysAgo: 26, arch: "leaver" },
    { key: "m12", name: "Sample Member 12", birthYear: 1981, feeStatus: "OVERDUE", batches: ["yoga"], joinedDaysAgo: 170, leftDaysAgo: 70, arch: "leaver" },
    { key: "m13", name: "Sample Member 13", birthYear: 1990, feeStatus: "PAID", batches: ["yoga"], joinedDaysAgo: 130, arch: "consistent" },
    { key: "m14", name: "Sample Member 14", birthYear: 1995, feeStatus: "DUE", batches: ["dance"], joinedDaysAgo: 100, arch: "steady" },
    { key: "m15", name: "Sample Member 15", birthYear: 1988, feeStatus: "PAID", batches: ["dance"], joinedDaysAgo: 60, arch: "sporadic" },
  ],
  levels: [{ sportSlug: "yoga", names: ["Beginner", "Steady", "Flow"] }],
  plans: [
    {
      key: "morning-flow", coach: "c1", title: "Daily Morning Flow", cadence: "DAILY", sportSlug: "yoga",
      description: "A gentle ten-minute yoga flow to do at home on non-class days.",
      days: [day(1, "Morning flow", [
        it("yoga-mountain-pose", 1, undefined, 60),
        it("yoga-cat-cow", 1, undefined, 90),
        it("yoga-downward-dog", 2, undefined, 60, 20),
        it("yoga-warrior-two", 2, undefined, 60, 20),
        it("yoga-child-pose", 1, undefined, 90),
      ])],
    },
    {
      key: "balance-core", coach: "c1", title: "Weekly Balance and Core", cadence: "WEEKLY", sportSlug: "yoga", version: 2,
      description: "Balance, glute and core work three times a week.",
      days: [
        day(1, "Balance", [it("yoga-tree-pose", 2, undefined, 45, 20), it("yoga-warrior-two", 2, undefined, 60, 20), it("yoga-bridge", 3, 10, undefined, 30)]),
        day(3, "Core", [it("Plank", 3, undefined, 40, 30), it("Side_Bridge", 3, undefined, 30, 30), it("yoga-bridge", 3, 12, undefined, 30)]),
        day(5, "Wind down", [it("yoga-cat-cow", 1, undefined, 90), it("yoga-child-pose", 1, undefined, 120), it("yoga-relaxation-breath", 1, undefined, 240)]),
      ],
    },
    {
      key: "dance-monthly", coach: "c2", title: "Dance Fitness Monthly Plan", cadence: "MONTHLY", sportSlug: "zumba",
      description: "Low-impact dance practice days to build stamina between classes.",
      days: rotate([2, 4, 7, 9, 11, 14, 16, 18, 21, 23, 25, 28], [
        { title: "Warm-up and steps", items: [it("zumba-march-warmup", 1, undefined, 180), it("zumba-grapevine", 3, undefined, 240, 30), it("zumba-side-step-reach", 3, undefined, 240, 30), it("zumba-cooldown-stretch", 1, undefined, 180)] },
        { title: "Combos", items: [it("zumba-march-warmup", 1, undefined, 180), it("zumba-low-impact-bounce", 3, undefined, 240, 30), it("zumba-hip-sway-combo", 3, undefined, 240, 30), it("zumba-cooldown-stretch", 1, undefined, 180)] },
      ]),
    },
    {
      key: "intro-stretch", coach: "c2", title: "Intro Stretch Routine (archived)", cadence: "WEEKLY", sportSlug: "yoga", status: "ARCHIVED",
      description: "Older starter routine, kept for history.",
      days: [
        day(2, "Stretch", [it("yoga-cat-cow", 1, undefined, 90), it("yoga-child-pose", 1, undefined, 90)]),
        day(6, "Stretch 2", [it("yoga-mountain-pose", 1, undefined, 60), it("yoga-bridge", 2, 10)]),
      ],
    },
  ],
  assignments: [
    ...["m1", "m2", "m3", "m13"].map((m, i) => ({ plan: "morning-flow", member: m, daysAgo: 56 - i * 7 })),
    { plan: "morning-flow", member: "m9", daysAgo: 7 },
    { plan: "balance-core", member: "m4", daysAgo: 42 },
    { plan: "balance-core", member: "m5", daysAgo: 49 },
    { plan: "dance-monthly", member: "m6", daysAgo: 35 },
    { plan: "dance-monthly", member: "m7", daysAgo: 28, status: "PAUSED" as const, endedDaysAgo: 12, note: "Paused for a family event." },
    { plan: "dance-monthly", member: "m8", daysAgo: 42 },
    { plan: "dance-monthly", member: "m10", daysAgo: 14 },
    { plan: "dance-monthly", member: "m14", daysAgo: 30 },
    { plan: "intro-stretch", member: "m11", daysAgo: 60, status: "ENDED" as const, endedDaysAgo: 26 },
    { plan: "intro-stretch", member: "m2", daysAgo: 80, status: "ENDED" as const, endedDaysAgo: 58 },
  ],
  customGoals: [
    { title: "Hold tree pose for 60 seconds", start: 15, target: 60, unit: "seconds" },
    { title: "Reach toes in a forward fold", start: -12, target: 0, unit: "cm" },
    { title: "Dance a full 30-minute class without a break", start: 12, target: 30, unit: "minutes" },
  ],
  extraAvailability: { c1: [[6, "09:00", "11:00"]], c2: [[1, "17:00", "19:00"], [6, "10:00", "12:00"]] },
};

export const RICH: RichTenant[] = [karate, gym, studio];
