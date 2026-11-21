import type { Prisma, PrismaClient } from "@prisma/client";
import { importCatalog, loadAllEntries } from "../catalog/import";
import { expandSchedule } from "../../lib/workouts/expand";
import { TENANTS, type SeedTenant } from "./data";
import { RICH, type Archetype, type AssignmentDef, type PlanDef, type RichTenant } from "./rich-data";
import { addDays, addMinutesHHmm, daysBetween, dbDate, isoDow, istAt, rnd, seedToday } from "./dates";

// Rich demo layer (STAR-63). Runs on top of the base seed (demo.ts): same three tenants, but
// with plans, assignments, workout logs, goals, ~12 weeks of sessions and attendance, upcoming
// sessions with bookings and a waitlist, availability, settings and the member updates feed.
//
// Idempotent by "clear and rewrite": every row this layer owns has an id starting with
// `seed-<slug>-r-`. clearRich() deletes exactly those rows, then the layer is inserted again
// with deterministic ids and values (all dates relative to SEED_TODAY / today in Asia/Kolkata).
// The exercise catalog is imported (upsert) into each tenant if it is not there yet.

const BASE_CUTOFF_JOIN = "2026-10-12"; // base seed sessions start 2026-10-19; keep joins before them
const CHUNK = 1500;

const prefix = (slug: string) => `seed-${slug}-r-`;

/** Remove every row of the rich layer (and nothing else) for all demo tenants. */
export async function clearRich(prisma: PrismaClient): Promise<void> {
  const tenants = await prisma.tenant.findMany({ where: { slug: { in: TENANTS.map((t) => t.slug) } }, select: { id: true, slug: true } });
  for (const t of tenants) {
    const p = prefix(t.slug);
    const byId = { id: { startsWith: p } };
    await prisma.memberUpdate.deleteMany({ where: byId });
    await prisma.workoutLog.deleteMany({ where: byId });
    await prisma.planAssignment.deleteMany({ where: { OR: [byId, { planId: { startsWith: p } }] } });
    await prisma.workoutPlan.deleteMany({ where: byId });
    await prisma.goalCheckIn.deleteMany({ where: byId });
    await prisma.achievement.deleteMany({ where: byId });
    await prisma.goal.deleteMany({ where: byId });
    await prisma.sessionBooking.deleteMany({ where: byId });
    await prisma.attendance.deleteMany({ where: byId });
    await prisma.excusedAbsence.deleteMany({ where: byId });
    await prisma.session.deleteMany({ where: byId });
    await prisma.memberLevel.deleteMany({ where: byId });
    await prisma.level.deleteMany({ where: byId });
    await prisma.batchMember.deleteMany({ where: byId });
    await prisma.member.deleteMany({ where: byId });
    await prisma.guardian.deleteMany({ where: byId });
    await prisma.user.deleteMany({ where: byId });
    await prisma.holiday.deleteMany({ where: byId });
    await prisma.coachAvailability.deleteMany({ where: byId });
    await prisma.tenantSettings.deleteMany({ where: { tenantId: t.id } });
  }
}

type M = {
  key: string;
  id: string;
  name: string;
  arch: Archetype;
  joined: string;
  left?: string;
  batches: string[];
  userId: string | null;
  guardianUserId: string | null;
  minor: boolean;
  base: boolean;
  sportSlug: string;
  rank: number; // current level rank (0 = none)
};

type SessionRow = Prisma.SessionCreateManyInput & { _batchKey: string; _date: string };

function pPresent(m: M, date: string, today: string): number {
  const weeksAgo = Math.floor(daysBetween(date, today) / 7);
  let p: number;
  switch (m.arch) {
    case "consistent": p = 0.96; break;
    case "steady": p = 0.86; break;
    case "sporadic": p = 0.64; break;
    case "new": p = 0.9; break;
    case "lapsed": p = weeksAgo >= 6 ? 0.9 : weeksAgo >= 3 ? 0.4 : 0.06; break;
    case "leaver": {
      const toLeave = m.left ? daysBetween(date, m.left) : 99;
      p = toLeave < 14 ? 0.3 : toLeave < 35 ? 0.6 : 0.85;
      break;
    }
  }
  const dow = isoDow(date);
  if (dow === 5) p *= 0.93;
  if (dow === 1) p *= 0.96;
  if (weeksAgo >= 9) p *= 0.92;
  return Math.min(0.99, p);
}

function pWorkout(m: M, date: string, today: string): number {
  const weeksAgo = Math.floor(daysBetween(date, today) / 7);
  switch (m.arch) {
    case "consistent": return 0.9;
    case "steady": return 0.68;
    case "sporadic": return 0.38;
    case "new": return 0.8;
    case "lapsed": return weeksAgo >= 6 ? 0.8 : weeksAgo >= 3 ? 0.35 : 0.05;
    case "leaver": {
      const toLeave = m.left ? daysBetween(date, m.left) : 99;
      return toLeave < 14 ? 0.2 : toLeave < 35 ? 0.5 : 0.8;
    }
  }
}

const NOTES = [
  "Sample note: good energy today.",
  "Sample note: worked on form; keep practising at home.",
  "Sample note: small group, lots of one-to-one feedback.",
  "Sample note: focus on consistency this week.",
  "Sample note: warm-up was extended after a slow start.",
  "Sample note: great teamwork in the closing drill.",
];
const KID_REASONS = ["EXAM", "ILLNESS", "FESTIVAL", "EXAM"] as const;
const ADULT_REASONS = ["ILLNESS", "TRAVEL", "FESTIVAL", "TRAVEL"] as const;

async function chunked<T>(rows: T[], write: (batch: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += CHUNK) await write(rows.slice(i, i + CHUNK));
}

export type RichCounts = Record<string, number>;

async function seedRichTenant(prisma: PrismaClient, t: SeedTenant, r: RichTenant, today: string): Promise<RichCounts> {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: t.slug } });
  const tenantId = tenant.id;
  const P = prefix(t.slug);
  const id = (thing: string) => `${P}${thing}`;
  const counts: RichCounts = {};

  // 1. Exercise catalog for this tenant (skip when already complete).
  const entries = loadAllEntries();
  const have = await prisma.exercise.count({ where: { tenantId } });
  if (have < entries.length) await importCatalog(prisma, tenantId, entries);
  const exerciseId = new Map((await prisma.exercise.findMany({ where: { tenantId }, select: { id: true, sourceId: true } })).map((e) => [e.sourceId, e.id]));
  counts.exercises = await prisma.exercise.count({ where: { tenantId } });

  // 2. Existing base entities.
  const email = (key: string) => `${key}@${t.slug}.example.test`;
  const coachId: Record<string, string> = {};
  for (const c of t.coaches) coachId[c.key] = (await prisma.user.findUniqueOrThrow({ where: { tenantId_email: { tenantId, email: email(c.key) } } })).id;
  const venue = await prisma.venue.findUniqueOrThrow({ where: { tenantId_name: { tenantId, name: t.venue.name } } });
  const sports = await prisma.sport.findMany({ where: { tenantId } });
  const sportBySlug = new Map(sports.map((s) => [s.slug, s]));
  const batchOf = (key: string) => t.batches.find((b) => b.key === key)!;
  const batchId = (key: string) => `seed-${t.slug}-batch-${key}`;
  const otherCoach = (c: string) => t.coaches.find((x) => x.key !== c)!.key;

  // 3. Rich levels for sports without belts (gym, yoga).
  for (const lv of r.levels) {
    const sport = sportBySlug.get(lv.sportSlug)!;
    await prisma.level.createMany({
      data: lv.names.map((name, i) => ({ id: id(`level-${lv.sportSlug}-${i + 1}`), tenantId, sportId: sport.id, name, rank: i + 1 })),
    });
  }
  const levelRows = await prisma.level.findMany({ where: { tenantId }, include: { sport: true }, orderBy: { rank: "asc" } });
  const levelsBySport = new Map<string, typeof levelRows>();
  for (const l of levelRows) levelsBySport.set(l.sport.slug, [...(levelsBySport.get(l.sport.slug) ?? []), l]);

  // 4. Member list (base members + rich extras).
  const baseRows = await prisma.member.findMany({ where: { tenantId, id: { in: t.members.map((m) => `seed-${t.slug}-member-${m.key}`) } }, include: { guardian: true } });
  const baseById = new Map(baseRows.map((m) => [m.id, m]));
  const members: M[] = [];
  const sportOfBatches = (bs: string[]) => batchOf(bs[0]).sport;
  for (const m of t.members) {
    const row = baseById.get(`seed-${t.slug}-member-${m.key}`)!;
    const batches = t.batches.filter((b) => b.members.includes(m.key)).map((b) => b.key);
    const joinedBy = addDays(today, -(r.baseJoinedDaysAgo[m.key] ?? 150));
    members.push({
      key: m.key, id: row.id, name: m.name, arch: r.baseArch[m.key] ?? "steady",
      joined: joinedBy < BASE_CUTOFF_JOIN ? joinedBy : BASE_CUTOFF_JOIN,
      batches, userId: row.userId, guardianUserId: row.guardian?.userId ?? null, minor: row.isMinor, base: true,
      sportSlug: sportOfBatches(batches), rank: m.level ? (levelsBySport.get(sportOfBatches(batches))?.find((l) => l.name === m.level)?.rank ?? 0) : 0,
    });
  }
  const userRows: Prisma.UserCreateManyInput[] = [];
  const guardianRows: Prisma.GuardianCreateManyInput[] = [];
  const memberRows: Prisma.MemberCreateManyInput[] = [];
  const guardianUser: Record<string, string> = {};
  for (const e of r.extras) {
    const mid = id(`member-${e.key}`);
    let userId: string | null = null;
    let guardianDbId: string | null = null;
    let gUserId: string | null = null;
    if (e.guardianKey) {
      if (!guardianUser[e.guardianKey]) {
        guardianUser[e.guardianKey] = id(`user-parent-${e.guardianKey}`);
        userRows.push({ id: guardianUser[e.guardianKey], tenantId, role: "CUSTOMER", email: email(`parent-${e.guardianKey}`), name: e.guardianName! });
        guardianRows.push({ id: id(`guardian-${e.guardianKey}`), tenantId, name: e.guardianName!, userId: guardianUser[e.guardianKey], phone: "+910000000000" });
      }
      guardianDbId = id(`guardian-${e.guardianKey}`);
      gUserId = guardianUser[e.guardianKey];
    } else {
      userId = id(`user-member-${e.key}`);
      userRows.push({ id: userId, tenantId, role: "CUSTOMER", email: email(`member-${e.key}`), name: e.name });
    }
    const joined = addDays(today, -e.joinedDaysAgo);
    const left = e.leftDaysAgo !== undefined ? addDays(today, -e.leftDaysAgo) : undefined;
    const sportSlug = sportOfBatches(e.batches);
    members.push({
      key: e.key, id: mid, name: e.name, arch: e.arch, joined, left, batches: e.batches,
      userId, guardianUserId: gUserId, minor: Boolean(e.guardianKey), base: false, sportSlug,
      rank: e.level ? (levelsBySport.get(sportSlug)?.find((l) => l.name === e.level)?.rank ?? 0) : 0,
    });
    memberRows.push({
      id: mid, tenantId, displayName: e.name, birthYear: e.birthYear, isMinor: Boolean(e.guardianKey),
      guardianId: guardianDbId, userId, isActive: !left, feeStatus: e.feeStatus, joinedOn: dbDate(joined), leftOn: left ? dbDate(left) : null,
    });
  }
  const mByKey = new Map(members.map((m) => [m.key, m]));

  // Fee mix with dates around today; applied to base and extra members alike.
  const feeFields = (m: M, status: "PAID" | "DUE" | "OVERDUE" | "WAIVED") => {
    if (m.left) {
      return { feeStatus: status, feeDueOn: null, feePaidOn: status === "PAID" ? dbDate(addDays(m.left, -5)) : null, feePaidMethod: status === "PAID" ? ("CASH" as const) : null };
    }
    switch (status) {
      case "PAID": {
        const paid = addDays(today, -(2 + Math.floor(rnd(t.slug, m.key, "paid") * 18)));
        return { feeStatus: status, feeDueOn: dbDate(addDays(paid, 30)), feePaidOn: dbDate(paid), feePaidMethod: rnd(t.slug, m.key, "method") < 0.5 ? ("UPI" as const) : ("CASH" as const) };
      }
      case "DUE":
        return { feeStatus: status, feeDueOn: dbDate(addDays(today, 1 + Math.floor(rnd(t.slug, m.key, "due") * 6))), feePaidOn: null, feePaidMethod: null };
      case "OVERDUE":
        return { feeStatus: status, feeDueOn: dbDate(addDays(today, -(4 + Math.floor(rnd(t.slug, m.key, "over") * 22)))), feePaidOn: null, feePaidMethod: null };
      case "WAIVED":
        return { feeStatus: status, feeDueOn: null, feePaidOn: null, feePaidMethod: null };
    }
  };

  // Base members: new joiners, fee dates.
  for (const m of members.filter((x) => x.base)) {
    const status = t.members.find((x) => x.key === m.key)!.feeStatus;
    await prisma.member.update({ where: { id: m.id }, data: { joinedOn: dbDate(m.joined), ...feeFields(m, status) } });
    for (const bk of m.batches) {
      await prisma.batchMember.updateMany({ where: { tenantId, batchId: batchId(bk), memberId: m.id }, data: { joinedOn: dbDate(m.joined) } });
    }
  }
  for (const row of memberRows) {
    const m = mByKey.get(String(row.id).slice(P.length + "member-".length))!;
    Object.assign(row, feeFields(m, row.feeStatus as "PAID" | "DUE" | "OVERDUE" | "WAIVED"));
  }
  await prisma.user.createMany({ data: userRows });
  await prisma.guardian.createMany({ data: guardianRows });
  await prisma.member.createMany({ data: memberRows });
  await prisma.batchMember.createMany({
    data: members.filter((m) => !m.base).flatMap((m) =>
      m.batches.map((bk) => ({ id: id(`enrol-${bk}-${m.key}`), tenantId, batchId: batchId(bk), memberId: m.id, joinedOn: dbDate(m.joined), leftOn: m.left ? dbDate(m.left) : null }))),
  });
  counts.members = members.length;
  counts.membersLeft = members.filter((m) => m.left).length;

  // 5. Level timeline for extras and for rich-level sports.
  const memberLevels: Prisma.MemberLevelCreateManyInput[] = [];
  for (const m of members) {
    const lvls = levelsBySport.get(m.sportSlug);
    if (!lvls || lvls.length === 0) continue;
    if (m.base && !r.levels.some((l) => l.sportSlug === m.sportSlug)) continue; // karate base levels come from the base seed
    if (r.levels.some((l) => l.sportSlug === m.sportSlug)) m.rank = m.arch === "consistent" ? lvls.length : m.arch === "steady" ? Math.min(2, lvls.length) : 1;
    for (const l of lvls) {
      if (l.rank > m.rank) continue;
      const on = addDays(m.joined, (l.rank - 1) * 45);
      memberLevels.push({
        id: id(`memberlevel-${m.key}-${l.rank}`), tenantId, memberId: m.id, levelId: l.id,
        achievedOn: dbDate(on > today ? today : on), awardedById: coachId[batchOf(m.batches[0]).coach], coachNote: l.rank === m.rank ? "Sample note: moving up steadily." : null,
      });
    }
  }
  await prisma.memberLevel.createMany({ data: memberLevels });

  // 6. Holidays (one past, one upcoming).
  const pastMonday = (() => { let d = addDays(today, -24); while (isoDow(d) !== 1) d = addDays(d, -1); return d; })();
  const holidayDates = [pastMonday, addDays(today, 9)];
  const baseHolidays = await prisma.holiday.findMany({ where: { tenantId }, select: { date: true } });
  const holidaySet = new Set([...baseHolidays.map((h) => h.date.toISOString().slice(0, 10)), ...holidayDates]);
  await prisma.holiday.createMany({
    data: holidayDates.map((d, i) => ({ id: id(`holiday-${i + 1}`), tenantId, date: dbDate(d), name: i === 0 ? "Sample regional holiday" : "Sample festival holiday" })),
    skipDuplicates: true,
  });

  // 7. Sessions + attendance.
  const sessions: SessionRow[] = [];
  const attendance: Prisma.AttendanceCreateManyInput[] = [];
  const excused: Prisma.ExcusedAbsenceCreateManyInput[] = [];
  const updates: Prisma.MemberUpdateCreateManyInput[] = [];
  const upd = (memberId: string, kind: Prisma.MemberUpdateCreateManyInput["kind"], entityType: string, entityId: string, actorId: string | null, createdAt: Date, params: Record<string, string>) =>
    updates.push({ id: id(`upd-${updates.length}`), tenantId, memberId, actorId, kind, entityType, entityId, params, createdAt });

  const pickedUnlogged = new Set<string>();
  let cancelledPick: string | null = null;
  t.batches.slice(0, 2).forEach((b) => {
    for (let n = 1; n <= 28; n++) {
      const d = addDays(today, -n);
      if (b.daysOfWeek.includes(isoDow(d)) && !holidaySet.has(d) && !b.sessionDates.includes(d)) { pickedUnlogged.add(`${b.key}|${d}`); break; }
    }
  });
  {
    const b = t.batches[0];
    for (let n = 20; n <= 30; n++) {
      const d = addDays(today, -n);
      if (b.daysOfWeek.includes(isoDow(d)) && !holidaySet.has(d) && !b.sessionDates.includes(d)) { cancelledPick = `${b.key}|${d}`; break; }
    }
  }
  const excusedKeys: { m: M; date: string; reason: (typeof KID_REASONS)[number] | (typeof ADULT_REASONS)[number]; coach: string }[] = [];
  for (const b of t.batches) {
    for (let off = -84; off <= 14; off++) {
      const date = addDays(today, off);
      if (!b.daysOfWeek.includes(isoDow(date))) continue;
      if (b.sessionDates.includes(date)) continue; // the base seed owns this exact session
      const key = `${b.key}|${date}`;
      const isPast = off < 0;
      const isHoliday = holidaySet.has(date);
      const unlogged = pickedUnlogged.has(key);
      const cancelledByCoach = cancelledPick === key;
      const sessionCoach = isPast && !isHoliday && !unlogged && !cancelledByCoach && rnd(t.slug, key, "sub") < 0.04 ? otherCoach(b.coach) : b.coach;
      let status: "SCHEDULED" | "COMPLETED" | "CANCELLED" = "SCHEDULED";
      if (isHoliday || cancelledByCoach) status = "CANCELLED";
      else if (isPast && !unlogged) status = "COMPLETED";
      const endsAt = istAt(date, b.endTime);
      const row: SessionRow = {
        _batchKey: b.key, _date: date,
        id: id(`ses-${b.key}-${date}`), tenantId, batchId: batchId(b.key), coachId: coachId[sessionCoach],
        startsAt: istAt(date, b.startTime), endsAt, status,
        completedAt: status === "COMPLETED" ? new Date(endsAt.getTime() + 5 * 60_000) : null,
        coachNote: status === "COMPLETED" && rnd(t.slug, key, "note") < 0.45 ? NOTES[Math.floor(rnd(t.slug, key, "n2") * NOTES.length)] : isHoliday ? "Sample holiday: no class." : null,
        cancelledAt: status === "CANCELLED" ? istAt(addDays(date, -1), "10:00") : null,
        cancelReason: isHoliday ? "Holiday" : cancelledByCoach ? "Sample: coach unavailable, class cancelled." : null,
      };
      sessions.push(row);

      const enrolled = members.filter((m) => m.batches.includes(b.key) && m.joined <= date && (!m.left || date <= m.left));
      if (status === "CANCELLED") {
        for (const m of enrolled) {
          if (off > -10) upd(m.id, "SESSION_CANCELLED", "session", row.id as string, coachId[b.coach], istAt(addDays(date, -1), "10:00"), { batchName: b.name, startsAt: (row.startsAt as Date).toISOString(), reason: isHoliday ? "holiday" : "coach_unavailable" });
        }
      }
      if (status !== "COMPLETED") continue;
      for (const m of enrolled) {
        const rr = rnd(t.slug, m.key, date, "att");
        let st: "PRESENT" | "ABSENT" | "EXCUSED" = "PRESENT";
        let reason: (typeof KID_REASONS)[number] | (typeof ADULT_REASONS)[number] | null = null;
        if (rr >= pPresent(m, date, today)) {
          if (rnd(t.slug, m.key, date, "exc") < 0.4) {
            st = "EXCUSED";
            const list = m.minor ? KID_REASONS : ADULT_REASONS;
            reason = list[Math.floor(rnd(t.slug, m.key, date, "why") * list.length)];
            excusedKeys.push({ m, date, reason, coach: sessionCoach });
          } else st = "ABSENT";
        }
        attendance.push({
          id: id(`att-${b.key}-${date}-${m.key}`), tenantId, sessionId: row.id as string, memberId: m.id, status: st, reason,
          note: st === "EXCUSED" && rnd(t.slug, m.key, date, "en") < 0.3 ? "Sample note: informed the coach in advance." : null,
          clientId: id(`att-${b.key}-${date}-${m.key}`), markedById: coachId[sessionCoach], markedAt: row.completedAt as Date,
        });
      }
    }
  }
  // Pre-declared excused absences: a few past ones and one upcoming.
  excusedKeys.filter((_, i) => i % 6 === 0).slice(0, 4).forEach((e, i) => {
    excused.push({ id: id(`excused-${i + 1}`), tenantId, memberId: e.m.id, fromDate: dbDate(e.date), toDate: dbDate(e.date), reason: e.reason, note: "Sample note: declared in advance.", createdById: coachId[e.coach] });
  });
  const travelMember = members.find((m) => !m.left && m.arch === "steady") ?? members[0];
  const travelFrom = addDays(today, 3);
  const travelTo = addDays(today, 5);
  excused.push({ id: id("excused-upcoming"), tenantId, memberId: travelMember.id, fromDate: dbDate(travelFrom), toDate: dbDate(travelTo), reason: "TRAVEL", note: "Sample family trip.", createdById: coachId[batchOf(travelMember.batches[0]).coach] });

  // 8. Bookings and the full session with a waitlist.
  const upcoming = sessions.filter((s) => s.status === "SCHEDULED" && s._date >= today);
  const bookings: Prisma.SessionBookingCreateManyInput[] = [];
  const bookedBy = (m: M, coach: string) => m.userId ?? m.guardianUserId ?? coachId[coach];
  const demo = r.demoCustomers.map((k) => mByKey.get(k)!).filter(Boolean);
  const fullBatch = t.batches[0];
  const fullSession = upcoming.filter((s) => s._batchKey === fullBatch.key && s._date >= addDays(today, 2))[0];
  if (fullSession) fullSession.capacity = 4;
  const nowStamp = istAt(today, "08:00");
  for (const s of upcoming) {
    const b = batchOf(s._batchKey);
    const sid = s.id as string;
    const eligible = members.filter((m) => !m.left && m.batches.includes(b.key) && m.joined <= s._date);
    if (s === fullSession) {
      const pool = [...eligible, ...members.filter((m) => !m.left && !m.batches.includes(b.key) && m.joined <= s._date)];
      const waitFirst = demo.find((d) => pool.includes(d) && !(travelMember === d && s._date >= travelFrom && s._date <= travelTo));
      const rest = pool.filter((m) => m !== waitFirst);
      const booked = rest.slice(0, 4);
      const waiting = [waitFirst, ...rest.slice(4)].filter((m): m is M => Boolean(m)).slice(0, 2);
      booked.forEach((m) => bookings.push({ id: id(`book-${sid.slice(P.length)}-${m.key}`), tenantId, sessionId: sid, memberId: m.id, status: "BOOKED", bookedById: bookedBy(m, b.coach), createdAt: addDaysTs(nowStamp, -3) }));
      waiting.forEach((m, i) => bookings.push({ id: id(`book-${sid.slice(P.length)}-${m.key}`), tenantId, sessionId: sid, memberId: m.id, status: "WAITLISTED", waitlistPosition: i + 1, bookedById: bookedBy(m, b.coach), createdAt: addDaysTs(nowStamp, -2) }));
      continue;
    }
    if (b.kind === "ONE_ON_ONE") {
      const m = eligible[Math.floor(rnd(t.slug, sid, "pt") * eligible.length)];
      if (m && rnd(t.slug, sid, "ptb") < 0.7) bookings.push({ id: id(`book-${sid.slice(P.length)}-${m.key}`), tenantId, sessionId: sid, memberId: m.id, status: "BOOKED", bookedById: bookedBy(m, b.coach), createdAt: addDaysTs(nowStamp, -1) });
      continue;
    }
    let taken = 0;
    const cap = b.capacity ?? 999;
    for (const m of eligible) {
      if (m === travelMember && s._date >= travelFrom && s._date <= travelTo) continue;
      const forced = demo.includes(m) && upcoming.filter((u) => u._batchKey === s._batchKey).slice(0, 2).includes(s);
      const rr = rnd(t.slug, sid, m.key, "book");
      if (!forced && rr >= 0.55) continue;
      const cancelled = !forced && rr > 0.5;
      if (!cancelled && taken >= cap) continue;
      if (!cancelled) taken++;
      bookings.push({
        id: id(`book-${sid.slice(P.length)}-${m.key}`), tenantId, sessionId: sid, memberId: m.id,
        status: cancelled ? "CANCELLED" : "BOOKED", cancelledAt: cancelled ? addDaysTs(nowStamp, -1) : null,
        bookedById: bookedBy(m, b.coach), createdAt: addDaysTs(nowStamp, -2),
      });
    }
  }
  // Booking-related feed entries (near-term bookings only); the first one is a promotion from the waitlist.
  const sessionById = new Map(sessions.map((s) => [s.id as string, s]));
  let promoted = false;
  for (const bk of bookings.filter((x) => x.status === "BOOKED").slice(0, 8)) {
    const s = sessionById.get(bk.sessionId)!;
    const b = batchOf(s._batchKey);
    const kind = !promoted ? "WAITLIST_PROMOTED" : "BOOKING_CONFIRMED";
    promoted = true;
    upd(bk.memberId, kind, "booking", bk.id as string, coachId[b.coach], bk.createdAt as Date, { batchName: b.name, startsAt: (s.startsAt as Date).toISOString() });
  }
  counts.bookings = bookings.length;
  counts.waitlisted = bookings.filter((b) => b.status === "WAITLISTED").length;

  await chunked(sessions, (rows) => prisma.session.createMany({ data: rows.map(({ _batchKey, _date, ...s }) => { void _batchKey; void _date; return s; }) }));
  await chunked(attendance, (rows) => prisma.attendance.createMany({ data: rows }));
  await prisma.excusedAbsence.createMany({ data: excused });
  await chunked(bookings, (rows) => prisma.sessionBooking.createMany({ data: rows }));
  counts.sessions = sessions.length;
  counts.sessionsScheduledPast = sessions.filter((s) => s.status === "SCHEDULED" && s._date < today).length;
  counts.sessionsCancelled = sessions.filter((s) => s.status === "CANCELLED").length;
  counts.attendance = attendance.length;

  // 9. Coach availability: merged weekday windows of each coach's batches plus a few open slots.
  const avail: Prisma.CoachAvailabilityCreateManyInput[] = [];
  for (const c of t.coaches) {
    const byDay = new Map<number, [string, string]>();
    for (const b of t.batches.filter((x) => x.coach === c.key)) {
      for (const wd of b.daysOfWeek) {
        const cur = byDay.get(wd);
        byDay.set(wd, cur ? [cur[0] < b.startTime ? cur[0] : b.startTime, cur[1] > b.endTime ? cur[1] : b.endTime] : [b.startTime, b.endTime]);
      }
    }
    const rows = [...byDay.entries()].sort((a, b) => a[0] - b[0]);
    for (const [wd, [s, e]] of rows) avail.push({ id: id(`avail-${c.key}-${wd}`), tenantId, coachId: coachId[c.key], weekday: wd, startTime: addMinutesHHmm(s, -30), endTime: addMinutesHHmm(e, 30), venueId: venue.id });
    let n = rows.length;
    for (const [wd, s, e] of r.extraAvailability[c.key] ?? []) {
      if (n >= 4 || byDay.has(wd)) continue;
      avail.push({ id: id(`avail-${c.key}-${wd}`), tenantId, coachId: coachId[c.key], weekday: wd, startTime: s, endTime: e, venueId: venue.id });
      n++;
    }
  }
  await prisma.coachAvailability.createMany({ data: avail });
  counts.availability = avail.length;

  // 10. Tenant settings.
  await prisma.tenantSettings.create({
    data: { id: id("settings"), tenantId, bookingCancelWindowMinutes: r.settings.cancelWindowMinutes, waitlistEnabled: r.settings.waitlistEnabled, showMissedSessionCost: r.settings.showMissedSessionCost },
  });

  // 11. Plans, days, items.
  const planDefs: PlanDef[] = r.plans;
  const planRows: Prisma.WorkoutPlanCreateManyInput[] = [];
  const dayRows: Prisma.WorkoutPlanDayCreateManyInput[] = [];
  const itemRows: Prisma.WorkoutPlanItemCreateManyInput[] = [];
  const itemMeta = new Map<string, { id: string; position: number; sets: number | null; reps: number | null; dur: number | null }[]>(); // key: planKey|dayIndex
  for (const p of planDefs) {
    const status = p.status ?? "ACTIVE";
    planRows.push({
      id: id(`plan-${p.key}`), tenantId, coachId: coachId[p.coach], title: p.title, description: p.description, cadence: p.cadence, sportSlug: p.sportSlug,
      status, version: p.version ?? 1, archivedAt: status === "ARCHIVED" ? istAt(addDays(today, -25), "10:00") : null,
      createdAt: istAt(addDays(today, -80), "10:00"), updatedAt: istAt(addDays(today, (p.version ?? 1) > 1 ? -12 : -80), "10:00"),
    });
    for (const d of p.days) {
      const dayId = id(`day-${p.key}-${d.dayIndex}`);
      dayRows.push({ id: dayId, tenantId, planId: id(`plan-${p.key}`), dayIndex: d.dayIndex, title: d.title });
      const metas: { id: string; position: number; sets: number | null; reps: number | null; dur: number | null }[] = [];
      d.items.forEach((item, pos) => {
        const ex = exerciseId.get(item.ex);
        if (!ex) throw new Error(`Seed exercise "${item.ex}" is not in the catalog for ${t.slug}`);
        const itemId = id(`item-${p.key}-${d.dayIndex}-${pos + 1}`);
        itemRows.push({ id: itemId, tenantId, dayId, exerciseId: ex, position: pos + 1, sets: item.sets ?? null, reps: item.reps ?? null, durationSeconds: item.dur ?? null, restSeconds: item.rest ?? null, notes: item.notes ?? null });
        metas.push({ id: itemId, position: pos + 1, sets: item.sets ?? null, reps: item.reps ?? null, dur: item.dur ?? null });
      });
      itemMeta.set(`${p.key}|${d.dayIndex}`, metas);
    }
  }
  await prisma.workoutPlan.createMany({ data: planRows });
  await prisma.workoutPlanDay.createMany({ data: dayRows });
  await prisma.workoutPlanItem.createMany({ data: itemRows });
  counts.plans = planRows.length;
  counts.planItems = itemRows.length;

  // 12. Assignments.
  const planByKey = new Map(planDefs.map((p) => [p.key, p]));
  type Asg = { def: AssignmentDef; id: string; m: M; start: string; end: string | null; to: string; plan: PlanDef };
  const asgs: Asg[] = [];
  const asgRows: Prisma.PlanAssignmentCreateManyInput[] = [];
  r.assignments.forEach((def, i) => {
    const m = mByKey.get(def.member)!;
    const plan = planByKey.get(def.plan)!;
    let start = addDays(today, -def.daysAgo);
    if (start < m.joined) start = m.joined;
    let end: string | null = null;
    let to = today;
    if (def.status === "ENDED") { end = addDays(today, -(def.endedDaysAgo ?? 7)); to = end; }
    if (def.status === "PAUSED") to = addDays(today, -(def.endedDaysAgo ?? 7));
    if (m.left && to > m.left) { to = m.left; end = end ?? m.left; }
    const aid = id(`asg-${i + 1}-${def.member}`);
    const version = plan.version ?? 1;
    asgs.push({ def, id: aid, m, start, end, to, plan });
    asgRows.push({
      id: aid, tenantId, planId: id(`plan-${plan.key}`), memberId: m.id, assignedById: coachId[plan.coach],
      status: def.status ?? "ACTIVE", startsOn: dbDate(start), endsOn: end ? dbDate(end) : null,
      planVersion: version > 1 && def.daysAgo > 12 ? 1 : version, note: def.note ?? null, createdAt: istAt(start, "09:00"),
    });
    upd(m.id, "PLAN_ASSIGNED", "assignment", aid, coachId[plan.coach], istAt(start, "09:00"), { planTitle: plan.title, startsOn: start, ...(def.note ? { note: def.note } : {}) });
    if (version > 1 && def.daysAgo > 12 && !def.status) upd(m.id, "PLAN_UPDATED", "plan", id(`plan-${plan.key}`), coachId[plan.coach], istAt(addDays(today, -12), "10:00"), { planTitle: plan.title });
    if (def.status === "ENDED") upd(m.id, "PLAN_ENDED", "assignment", aid, coachId[plan.coach], istAt(end!, "10:00"), { planTitle: plan.title, status: "ended" });
    if (def.status === "PAUSED") upd(m.id, "PLAN_UPDATED", "assignment", aid, coachId[plan.coach], istAt(to, "10:00"), { planTitle: plan.title, status: "paused" });
  });
  await prisma.planAssignment.createMany({ data: asgRows });
  counts.assignments = asgRows.length;
  counts.membersAssigned = new Set(asgs.filter((a) => !a.m.left).map((a) => a.m.key)).size;

  // 13. Workout logs from the expanded schedule.
  const logs: Prisma.WorkoutLogCreateManyInput[] = [];
  for (const a of asgs) {
    const cadence = a.plan.cadence.toLowerCase() as "daily" | "weekly" | "monthly";
    const sched = expandSchedule(
      { status: "active", startsOn: a.start, endsOn: a.to },
      { cadence, days: a.plan.days.map((d) => ({ dayIndex: d.dayIndex, items: itemMeta.get(`${a.plan.key}|${d.dayIndex}`)!.map((x) => ({ id: x.id })) })) },
      a.start, a.to,
    );
    const recorder = a.m.userId ?? a.m.guardianUserId ?? coachId[a.plan.coach];
    const isDemoToday = r.demoCustomers.includes(a.m.key) && !a.def.status;
    for (const sd of sched) {
      const metas = itemMeta.get(`${a.plan.key}|${sd.dayIndex}`)!;
      const isToday = sd.date === today;
      if (isToday && !isDemoToday) continue;
      const dayR = rnd(t.slug, a.m.key, a.plan.key, sd.date, "wk");
      const pc = pWorkout(a.m, sd.date, today);
      for (const [pos, meta] of metas.entries()) {
        let status: "COMPLETED" | "SKIPPED" | "STARTED" | null;
        if (isToday) status = pos === 0 ? "COMPLETED" : pos === 1 ? "STARTED" : null;
        else if (dayR < pc && rnd(t.slug, a.m.key, meta.id, sd.date, "it") < 0.96) status = "COMPLETED";
        else if (dayR < pc + (1 - pc) * 0.3) status = "SKIPPED";
        else status = null;
        if (!status) continue;
        const startAt = new Date(istAt(sd.date, "07:00").getTime() + pos * 9 * 60_000);
        const seconds = meta.dur ?? (meta.sets ?? 1) * 70;
        const full = rnd(t.slug, meta.id, sd.date, "full") < 0.8;
        const done = status === "COMPLETED";
        logs.push({
          id: id(`log-${a.id.slice(P.length)}-${meta.id.slice(P.length)}-${sd.date}`), tenantId, assignmentId: a.id, planItemId: meta.id, memberId: a.m.id,
          scheduledFor: dbDate(sd.date), status,
          startedAt: status === "SKIPPED" ? null : startAt,
          completedAt: done ? new Date(startAt.getTime() + seconds * 1000) : null,
          actualSets: done && meta.sets ? (full ? meta.sets : Math.max(1, meta.sets - 1)) : null,
          actualReps: done && meta.reps ? (full ? meta.reps : Math.max(1, meta.reps - 2)) : null,
          actualDurationSeconds: done ? seconds : null,
          note: status === "SKIPPED" ? "Sample note: skipped, felt tired." : done && rnd(t.slug, meta.id, sd.date, "ln") < 0.06 ? "Sample note: felt strong today." : null,
          clientId: id(`log-${a.id.slice(P.length)}-${meta.id.slice(P.length)}-${sd.date}`), recordedById: recorder,
        });
      }
    }
  }
  await chunked(logs, (rows) => prisma.workoutLog.createMany({ data: rows }));
  counts.workoutLogs = logs.length;
  counts.workoutLogsCompleted = logs.filter((l) => l.status === "COMPLETED").length;
  counts.workoutLogsSkipped = logs.filter((l) => l.status === "SKIPPED").length;

  // 14. Goals, check-ins, achievements.
  const goals: Prisma.GoalCreateManyInput[] = [];
  const checkIns: Prisma.GoalCheckInCreateManyInput[] = [];
  const achievements: Prisma.AchievementCreateManyInput[] = [];
  const assignedKeys = new Set(asgs.map((a) => a.m.key));
  const coachOf = (m: M) => coachId[batchOf(m.batches[0]).coach];
  const kinds = ["SESSIONS_ATTENDED", "WORKOUTS_COMPLETED", "LEVEL", "CUSTOM"] as const;
  let achievedCustom = false;
  const goalOnce = (m: M, n: number, kind: (typeof kinds)[number], opts: { achieved?: boolean; dropped?: boolean } = {}) => {
    const gid = id(`goal-${m.key}-${n}`);
    const lvls = levelsBySport.get(m.sportSlug);
    const next = lvls?.find((l) => l.rank === m.rank + 1);
    let k = kind;
    if (k === "WORKOUTS_COMPLETED" && !assignedKeys.has(m.key)) k = "SESSIONS_ATTENDED";
    if (k === "LEVEL" && !next) k = "CUSTOM";
    const startsOn = (() => { const s = addDays(today, -(opts.achieved ? 75 : 45 + Math.floor(rnd(t.slug, m.key, n, "gs") * 20))); return s < m.joined ? m.joined : s; })();
    const base = { id: gid, tenantId, memberId: m.id, sportId: sportBySlug.get(m.sportSlug)?.id ?? null, startsOn: dbDate(startsOn), createdById: coachOf(m), status: opts.achieved ? ("ACHIEVED" as const) : opts.dropped ? ("DROPPED" as const) : ("ACTIVE" as const), createdAt: istAt(startsOn, "10:00") };
    let title = "";
    if (k === "SESSIONS_ATTENDED") {
      const target = opts.achieved ? 20 : 24;
      title = opts.achieved ? "Attend your first 20 classes" : "Attend 24 classes this quarter";
      goals.push({ ...base, title, metric: k, targetSessions: target, targetValue: target, startValue: 0, unit: "sessions", targetDate: dbDate(addDays(opts.achieved ? today : startsOn, opts.achieved ? -9 : 90)) });
    } else if (k === "WORKOUTS_COMPLETED") {
      title = "Complete 30 home workouts";
      goals.push({ ...base, title, metric: k, targetValue: 30, startValue: 0, unit: "workouts", targetDate: dbDate(addDays(startsOn, 90)) });
    } else if (k === "LEVEL") {
      title = `Reach ${next!.name}${m.sportSlug === "karate" ? " belt" : " level"}`;
      goals.push({ ...base, title, metric: k, targetLevelId: next!.id, targetDate: dbDate(addDays(today, 60 + Math.floor(rnd(t.slug, m.key, "ld") * 30))) });
    } else {
      const cg = r.customGoals[(m.key.length + n + members.indexOf(m)) % r.customGoals.length];
      title = cg.title;
      const count = 3 + Math.floor(rnd(t.slug, m.key, n, "ci") * 3); // 3 to 5
      const first = addDays(startsOn, 7);
      goals.push({ ...base, title, metric: "CUSTOM", targetValue: cg.target, startValue: cg.start, unit: cg.unit, targetDate: dbDate(addDays(today, 40)) });
      for (let i = 0; i < count; i++) {
        const date = addDays(first, i * 9);
        if (date > addDays(today, -1)) break;
        const frac = opts.achieved && i === count - 1 ? 1 : Math.min(0.92, ((i + 1) / (count + 1)) * (0.9 + rnd(t.slug, m.key, n, i, "fr") * 0.2));
        const value = Math.round((cg.start + (cg.target - cg.start) * frac) * 10) / 10;
        checkIns.push({ id: id(`checkin-${m.key}-${n}-${i + 1}`), tenantId, goalId: gid, value, note: i === 0 ? "Sample note: starting point." : null, recordedOn: dbDate(date), recordedById: coachOf(m) });
      }
    }
    upd(m.id, "GOAL_SET", "goal", gid, coachOf(m), istAt(startsOn, "10:00"), { goalTitle: title });
    if (opts.achieved) {
      upd(m.id, "GOAL_UPDATED", "goal", gid, coachOf(m), istAt(addDays(today, -9), "10:00"), { goalTitle: title, status: "achieved" });
      achievements.push({ id: id(`ach-${m.key}-${n}`), tenantId, memberId: m.id, goalId: gid, code: "goal_achieved", title, measureUnit: "SESSIONS", measureValue: k === "SESSIONS_ATTENDED" ? 20 : 1, earnedAt: istAt(addDays(today, -9), "10:00") });
    }
  };
  members.forEach((m, idx) => {
    if (m.left) { goalOnce(m, 1, "SESSIONS_ATTENDED", { dropped: true }); return; }
    if (r.demoCustomers.includes(m.key)) {
      goalOnce(m, 1, "SESSIONS_ATTENDED");
      goalOnce(m, 2, "WORKOUTS_COMPLETED");
      goalOnce(m, 3, "LEVEL");
      goalOnce(m, 4, "CUSTOM");
      goalOnce(m, 5, "SESSIONS_ATTENDED", { achieved: true });
      return;
    }
    goalOnce(m, 1, kinds[idx % 4]);
    if (idx % 3 === 0) goalOnce(m, 2, "CUSTOM");
    if (!achievedCustom && m.arch === "consistent") { achievedCustom = true; goalOnce(m, 3, "CUSTOM", { achieved: true }); }
    if (m.arch === "consistent" || m.arch === "steady") {
      achievements.push({ id: id(`ach-${m.key}-s10`), tenantId, memberId: m.id, code: "sessions_10", title: "First 10 sessions", measureUnit: "SESSIONS", measureValue: 10, earnedAt: istAt(addDays(m.joined, 35), "12:00") });
    }
    if (m.arch === "consistent") {
      achievements.push({ id: id(`ach-${m.key}-st7`), tenantId, memberId: m.id, code: "streak_7_days", title: "7-day workout streak", measureUnit: "STREAK_DAYS", measureValue: 7, earnedAt: istAt(addDays(m.joined, 70), "12:00") });
    }
  });
  await prisma.goal.createMany({ data: goals });
  await prisma.goalCheckIn.createMany({ data: checkIns });
  await prisma.achievement.createMany({ data: achievements });
  counts.goals = goals.length;
  counts.goalCheckIns = checkIns.length;
  counts.achievements = achievements.length;

  // 15. Member updates feed: read state (older read, recent unread, demo customers keep their latest 3 unread).
  const byMember = new Map<string, Prisma.MemberUpdateCreateManyInput[]>();
  for (const u of updates) byMember.set(u.memberId, [...(byMember.get(u.memberId) ?? []), u]);
  for (const [mid, list] of byMember) {
    list.sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime());
    const isDemo = demo.some((d) => d.id === mid);
    list.forEach((u, i) => {
      const age = daysBetween((u.createdAt as Date).toISOString().slice(0, 10), today);
      const unread = isDemo ? i < 3 : age <= 5;
      u.readAt = unread ? null : new Date((u.createdAt as Date).getTime() + 36 * 3_600_000);
    });
  }
  // Guarantee at least a couple of unread, recent entries for each demo customer.
  for (const d of demo) {
    const list = byMember.get(d.id) ?? [];
    if (list.length < 3) {
      const gaps = 3 - list.length;
      for (let i = 0; i < gaps; i++) {
        upd(d.id, "SESSION_SCHEDULED", "session", fullSession ? (fullSession.id as string) : id("none"), coachId[batchOf(d.batches[0]).coach], istAt(addDays(today, -i), "09:30"), { batchName: batchOf(d.batches[0]).name, startsAt: fullSession ? (fullSession.startsAt as Date).toISOString() : istAt(today, "09:00").toISOString() });
      }
    }
  }
  await chunked(updates, (rows) => prisma.memberUpdate.createMany({ data: rows }));
  counts.memberUpdates = updates.length;
  counts.memberUpdatesUnread = updates.filter((u) => !u.readAt).length;
  counts.holidays = holidayDates.length;
  counts.excusedAbsences = excused.length;

  return counts;
}

const addDaysTs = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/** Seeds the rich layer on top of the base seed. The base seed must have run first. */
export async function seedRich(prisma: PrismaClient, today = seedToday()): Promise<Record<string, RichCounts>> {
  const out: Record<string, RichCounts> = {};
  for (const t of TENANTS) {
    const r = RICH.find((x) => x.slug === t.slug)!;
    out[t.slug] = await seedRichTenant(prisma, t, r, today);
  }
  return out;
}
