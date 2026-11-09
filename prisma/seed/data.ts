// Demo seed content. Everything here is synthetic: invented business names, placeholder
// people ("Sample Kid 01"), reserved example.test emails, and no photos. Nothing refers to
// a real person or a real child.

export type SeedBatch = {
  key: string;
  name: string;
  sport: string;
  coach: string; // coach key
  kind: "GROUP_CLASS" | "ONE_ON_ONE";
  capacity: number | null;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  // past session dates (YYYY-MM-DD), all before the seed's fixed "today"
  sessionDates: string[];
  members: string[]; // member keys
};

export type SeedMember = {
  key: string;
  name: string;
  birthYear: number;
  guardian?: string; // guardian key => minor
  feeStatus: "PAID" | "DUE" | "OVERDUE" | "WAIVED";
  level?: string; // current level name for the sport of its first batch
};

export type SeedTenant = {
  slug: string;
  name: string;
  theme: {
    logoUrl: string;
    primaryHex: string;
    secondaryHex: string;
    accentHex: string;
    surfaceHex: string;
    textHex: string;
  };
  venue: { name: string; city: string };
  sports: { slug: string; name: string; levels?: { name: string; colorHex: string }[] }[];
  owner: { key: string; name: string };
  coaches: { key: string; name: string }[];
  guardians: { key: string; name: string }[];
  members: SeedMember[];
  batches: SeedBatch[];
  holiday: { date: string; name: string };
};

const kids = (n: number, from: number) => Array.from({ length: n }, (_, i) => `k${from + i}`);
const pad = (n: number) => String(n).padStart(2, "0");

export const TENANTS: SeedTenant[] = [
  {
    slug: "demo-karate",
    name: "Sample Dojo (demo karate academy)",
    theme: { logoUrl: "/tenants/demo-karate.svg", primaryHex: "#B3202A", secondaryHex: "#1A1A1A", accentHex: "#F2C94C", surfaceHex: "#FFF8F6", textHex: "#1A1A1A" },
    venue: { name: "Sample Dojo Main Hall", city: "Demo City" },
    sports: [
      {
        slug: "karate",
        name: "Karate",
        levels: [
          { name: "White", colorHex: "#FFFFFF" },
          { name: "Yellow", colorHex: "#F2C94C" },
          { name: "Orange", colorHex: "#F2994A" },
          { name: "Green", colorHex: "#27AE60" },
          { name: "Blue", colorHex: "#2F80ED" },
          { name: "Brown", colorHex: "#8B5E3C" },
          { name: "Black", colorHex: "#111111" },
        ],
      },
    ],
    owner: { key: "owner", name: "Sample Owner (Dojo)" },
    coaches: [
      { key: "c1", name: "Sample Coach Alpha" },
      { key: "c2", name: "Sample Coach Beta" },
    ],
    guardians: Array.from({ length: 6 }, (_, i) => ({ key: `g${i + 1}`, name: `Sample Parent ${pad(i + 1)}` })),
    members: [
      ...Array.from({ length: 6 }, (_, i): SeedMember => ({
        key: `k${i + 1}`,
        name: `Sample Kid ${pad(i + 1)}`,
        birthYear: 2015 + (i % 4),
        guardian: `g${i + 1}`,
        feeStatus: (["PAID", "PAID", "DUE", "OVERDUE", "PAID", "WAIVED"] as const)[i],
        level: (["White", "White", "Yellow", "Yellow", "Orange", "White"] as const)[i],
      })),
      { key: "a1", name: "Sample Adult 01", birthYear: 1993, feeStatus: "PAID", level: "Green" },
      { key: "a2", name: "Sample Adult 02", birthYear: 1988, feeStatus: "DUE", level: "Blue" },
    ],
    batches: [
      { key: "kids", name: "Kids Karate (Mon/Wed/Fri)", sport: "karate", coach: "c1", kind: "GROUP_CLASS", capacity: 20, daysOfWeek: [1, 3, 5], startTime: "17:00", endTime: "18:00", sessionDates: ["2026-10-19", "2026-10-21", "2026-10-23", "2026-10-26"], members: kids(6, 1) },
      { key: "adults", name: "Adults Karate (Tue/Thu)", sport: "karate", coach: "c2", kind: "GROUP_CLASS", capacity: 15, daysOfWeek: [2, 4], startTime: "19:00", endTime: "20:00", sessionDates: ["2026-10-20", "2026-10-22", "2026-10-27"], members: ["a1", "a2"] },
    ],
    holiday: { date: "2026-10-21", name: "Sample festival holiday" },
  },
  {
    slug: "demo-gym",
    name: "Sample Iron Works (demo gym)",
    theme: { logoUrl: "/tenants/demo-gym.svg", primaryHex: "#1F2A44", secondaryHex: "#F5A623", accentHex: "#E4572E", surfaceHex: "#F4F6FA", textHex: "#10182B" },
    venue: { name: "Sample Iron Works Floor", city: "Demo City" },
    sports: [{ slug: "gym", name: "Gym training" }],
    owner: { key: "owner", name: "Sample Owner (Gym)" },
    coaches: [
      { key: "c1", name: "Sample Trainer Gamma" },
      { key: "c2", name: "Sample Trainer Delta" },
    ],
    guardians: [],
    members: Array.from({ length: 8 }, (_, i): SeedMember => ({
      key: `m${i + 1}`,
      name: `Sample Member ${pad(i + 1)}`,
      birthYear: 1980 + i * 3,
      feeStatus: (["PAID", "PAID", "DUE", "PAID", "OVERDUE", "PAID", "DUE", "PAID"] as const)[i],
    })),
    batches: [
      { key: "morning", name: "Morning Strength Floor", sport: "gym", coach: "c1", kind: "GROUP_CLASS", capacity: 12, daysOfWeek: [1, 2, 3, 4, 5], startTime: "06:30", endTime: "07:30", sessionDates: ["2026-10-19", "2026-10-20", "2026-10-21"], members: ["m1", "m2", "m3", "m4"] },
      { key: "pt", name: "Personal Training Slot", sport: "gym", coach: "c2", kind: "ONE_ON_ONE", capacity: 1, daysOfWeek: [2, 4, 6], startTime: "18:00", endTime: "19:00", sessionDates: ["2026-10-20", "2026-10-22", "2026-10-24"], members: ["m5", "m6"] },
      { key: "evening", name: "Evening Strength Floor", sport: "gym", coach: "c1", kind: "GROUP_CLASS", capacity: 12, daysOfWeek: [1, 3, 5], startTime: "18:30", endTime: "19:30", sessionDates: ["2026-10-19", "2026-10-21", "2026-10-23"], members: ["m7", "m8", "m1"] },
    ],
    holiday: { date: "2026-10-21", name: "Sample festival holiday" },
  },
  {
    slug: "demo-studio",
    name: "Sample Flow Studio (demo group classes)",
    theme: { logoUrl: "/tenants/demo-studio.svg", primaryHex: "#2E8B6E", secondaryHex: "#F7F3E9", accentHex: "#D96C9B", surfaceHex: "#F7FBF9", textHex: "#16352B" },
    venue: { name: "Sample Flow Studio Room 1", city: "Demo City" },
    sports: [
      { slug: "yoga", name: "Yoga" },
      { slug: "zumba", name: "Dance fitness" },
    ],
    owner: { key: "owner", name: "Sample Owner (Studio)" },
    coaches: [
      { key: "c1", name: "Sample Instructor Epsilon" },
      { key: "c2", name: "Sample Instructor Zeta" },
    ],
    guardians: [],
    members: Array.from({ length: 8 }, (_, i): SeedMember => ({
      key: `m${i + 1}`,
      name: `Sample Member ${pad(i + 1)}`,
      birthYear: 1985 + i * 2,
      feeStatus: (["PAID", "DUE", "PAID", "PAID", "OVERDUE", "PAID", "WAIVED", "PAID"] as const)[i],
    })),
    batches: [
      { key: "yoga", name: "Morning Yoga", sport: "yoga", coach: "c1", kind: "GROUP_CLASS", capacity: 10, daysOfWeek: [1, 3, 5], startTime: "07:00", endTime: "08:00", sessionDates: ["2026-10-19", "2026-10-21", "2026-10-23"], members: ["m1", "m2", "m3", "m4", "m5"] },
      { key: "dance", name: "Evening Dance Fitness", sport: "zumba", coach: "c2", kind: "GROUP_CLASS", capacity: 8, daysOfWeek: [2, 4], startTime: "18:30", endTime: "19:30", sessionDates: ["2026-10-20", "2026-10-22", "2026-10-27"], members: ["m4", "m5", "m6", "m7", "m8"] },
    ],
    holiday: { date: "2026-10-21", name: "Sample festival holiday" },
  },
];
