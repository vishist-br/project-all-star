import type { PrismaClient } from "@prisma/client";
import { TENANTS, type SeedTenant } from "./data";

// Idempotent demo seed. Every row has a deterministic id ("seed-<slug>-<thing>") and is
// written with upsert, so running it twice changes nothing. Tenant rows are keyed by slug.

const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
const at = (d: string, hhmm: string) => new Date(`${d}T${hhmm}:00+05:30`);

/** Deterministic attendance outcome so re-runs and tests are stable. */
export function outcome(memberIdx: number, sessionIdx: number): "PRESENT" | "ABSENT" | "EXCUSED" {
  const n = (memberIdx * 7 + sessionIdx * 3) % 10;
  if (n === 4) return "ABSENT";
  if (n === 8) return "EXCUSED";
  return "PRESENT";
}

async function seedTenant(prisma: PrismaClient, t: SeedTenant) {
  const id = (thing: string) => `seed-${t.slug}-${thing}`;
  const tenant = await prisma.tenant.upsert({
    where: { slug: t.slug },
    update: { name: t.name },
    create: { id: id("tenant"), slug: t.slug, name: t.name },
  });
  const tenantId = tenant.id;

  await prisma.tenantTheme.upsert({
    where: { tenantId },
    update: { brandName: t.name, ...t.theme },
    create: { id: id("theme"), tenantId, brandName: t.name, ...t.theme },
  });

  const email = (key: string) => `${key}@${t.slug}.example.test`;
  const upsertUser = (key: string, role: "OWNER" | "COACH" | "CUSTOMER", name: string) =>
    prisma.user.upsert({
      where: { tenantId_email: { tenantId, email: email(key) } },
      update: { name, role },
      create: { id: id(`user-${key}`), tenantId, email: email(key), name, role },
    });

  await upsertUser(t.owner.key, "OWNER", t.owner.name);
  const coachId: Record<string, string> = {};
  for (const c of t.coaches) coachId[c.key] = (await upsertUser(c.key, "COACH", c.name)).id;

  const venue = await prisma.venue.upsert({
    where: { tenantId_name: { tenantId, name: t.venue.name } },
    update: { city: t.venue.city },
    create: { id: id("venue"), tenantId, name: t.venue.name, city: t.venue.city },
  });

  const sportId: Record<string, string> = {};
  const levelId: Record<string, Record<string, { id: string; rank: number }>> = {};
  for (const s of t.sports) {
    const sport = await prisma.sport.upsert({
      where: { tenantId_slug: { tenantId, slug: s.slug } },
      update: { name: s.name },
      create: { id: id(`sport-${s.slug}`), tenantId, slug: s.slug, name: s.name },
    });
    sportId[s.slug] = sport.id;
    levelId[s.slug] = {};
    for (const [i, l] of (s.levels ?? []).entries()) {
      const lv = await prisma.level.upsert({
        where: { tenantId_sportId_rank: { tenantId, sportId: sport.id, rank: i + 1 } },
        update: { name: l.name, colorHex: l.colorHex },
        create: { id: id(`level-${s.slug}-${i + 1}`), tenantId, sportId: sport.id, name: l.name, rank: i + 1, colorHex: l.colorHex },
      });
      levelId[s.slug][l.name] = { id: lv.id, rank: i + 1 };
    }
  }

  const guardianId: Record<string, string> = {};
  for (const g of t.guardians) {
    const user = await upsertUser(`parent-${g.key}`, "CUSTOMER", g.name);
    const row = await prisma.guardian.upsert({
      where: { id: id(`guardian-${g.key}`) },
      update: { name: g.name, userId: user.id },
      create: { id: id(`guardian-${g.key}`), tenantId, name: g.name, userId: user.id, phone: "+910000000000" },
    });
    guardianId[g.key] = row.id;
  }

  const memberId: Record<string, string> = {};
  for (const m of t.members) {
    const isMinor = Boolean(m.guardian);
    const userId = isMinor ? null : (await upsertUser(`member-${m.key}`, "CUSTOMER", m.name)).id;
    const data = {
      displayName: m.name,
      birthYear: m.birthYear,
      isMinor,
      guardianId: m.guardian ? guardianId[m.guardian] : null,
      userId,
      feeStatus: m.feeStatus,
      feeDueOn: m.feeStatus === "PAID" || m.feeStatus === "WAIVED" ? null : day("2026-10-31"),
      joinedOn: day("2026-01-05"),
    };
    const row = await prisma.member.upsert({
      where: { id: id(`member-${m.key}`) },
      update: data,
      create: { id: id(`member-${m.key}`), tenantId, ...data },
    });
    memberId[m.key] = row.id;
  }

  // Levels / belts timeline for members that have one.
  for (const m of t.members) {
    if (!m.level) continue;
    const sportSlug = t.batches.find((b) => b.members.includes(m.key))!.sport;
    const target = levelId[sportSlug][m.level];
    for (const [name, lv] of Object.entries(levelId[sportSlug])) {
      if (lv.rank > target.rank) continue;
      await prisma.memberLevel.upsert({
        where: { tenantId_memberId_levelId: { tenantId, memberId: memberId[m.key], levelId: lv.id } },
        update: {},
        create: {
          id: id(`memberlevel-${m.key}-${lv.rank}`),
          tenantId,
          memberId: memberId[m.key],
          levelId: lv.id,
          achievedOn: day(`2026-${String(Math.min(lv.rank * 2, 9)).padStart(2, "0")}-01`),
          coachNote: name === m.level ? "Sample note: steady progress." : null,
        },
      });
    }
  }

  const holidayDate = day(t.holiday.date);
  await prisma.holiday.upsert({
    where: { tenantId_date: { tenantId, date: holidayDate } },
    update: { name: t.holiday.name },
    create: { id: id("holiday"), tenantId, date: holidayDate, name: t.holiday.name },
  });

  for (const b of t.batches) {
    const batchId = id(`batch-${b.key}`);
    const data = {
      venueId: venue.id,
      sportId: sportId[b.sport],
      coachId: coachId[b.coach],
      name: b.name,
      kind: b.kind,
      capacity: b.capacity,
      daysOfWeek: b.daysOfWeek,
      startTime: b.startTime,
      endTime: b.endTime,
    };
    await prisma.batch.upsert({
      where: { id: batchId },
      update: data,
      create: { id: batchId, tenantId, ...data },
    });
    for (const mk of b.members) {
      await prisma.batchMember.upsert({
        where: { tenantId_batchId_memberId: { tenantId, batchId, memberId: memberId[mk] } },
        update: {},
        create: { id: id(`enrol-${b.key}-${mk}`), tenantId, batchId, memberId: memberId[mk], joinedOn: day("2026-01-05") },
      });
    }

    for (const [si, date] of b.sessionDates.entries()) {
      const isHoliday = date === t.holiday.date;
      const startsAt = at(date, b.startTime);
      const sessionData = {
        coachId: coachId[b.coach],
        endsAt: at(date, b.endTime),
        status: isHoliday ? ("CANCELLED" as const) : ("COMPLETED" as const),
        completedAt: isHoliday ? null : at(date, b.endTime),
        coachNote: isHoliday ? "Sample holiday: no class." : "Sample note: good effort today.",
      };
      const session = await prisma.session.upsert({
        where: { tenantId_batchId_startsAt: { tenantId, batchId, startsAt } },
        update: sessionData,
        create: { id: id(`session-${b.key}-${si}`), tenantId, batchId, startsAt, ...sessionData },
      });
      if (isHoliday) continue; // holidays never count as missed, so no roll call
      for (const [mi, mk] of b.members.entries()) {
        const status = outcome(mi, si);
        const clientId = `seed-${t.slug}-att-${b.key}-${si}-${mk}`;
        const attData = {
          status,
          reason: status === "EXCUSED" ? ("TRAVEL" as const) : null,
          markedById: coachId[b.coach],
          markedAt: sessionData.completedAt ?? startsAt,
        };
        await prisma.attendance.upsert({
          where: { tenantId_sessionId_memberId: { tenantId, sessionId: session.id, memberId: memberId[mk] } },
          update: attData,
          create: { id: id(`att-${b.key}-${si}-${mk}`), tenantId, sessionId: session.id, memberId: memberId[mk], clientId, ...attData },
        });
      }
    }
  }

  return tenantId;
}

export async function seedDemo(prisma: PrismaClient): Promise<string[]> {
  const ids: string[] = [];
  for (const t of TENANTS) ids.push(await seedTenant(prisma, t));
  return ids;
}
