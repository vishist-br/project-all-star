import type { PrismaClient } from "@prisma/client";
import { assertCanManageMember, assertCanViewMember, memberWhere } from "../auth/access";
import { ApiError } from "../auth/errors";
import type { Principal } from "../auth/principal";
import { hashToken, newToken } from "../auth/tokens";
import { forTenant, type TenantClient } from "../tenant-scope";
import {
  LINK_LIFETIME_DAYS,
  MAX_CARD_GOALS,
  MAX_LIVE_LINKS,
  NOTE_MAX_LENGTH,
  TOKEN_PATTERN,
  isMonday,
  linkExpiry,
  mondayOf,
  scrubNames,
  firstNameOf,
  weekEndOf,
} from "../progress-card/rules";
import { Problems, dateFromDb, dateToDb, isDateString } from "../workouts/validate";
import { listGoals } from "./goals";
import { getMemberStats } from "./member-stats";
import { tenantDate } from "./pagination";

/**
 * The weekly progress card. Everything on it is what the member and family already see on the
 * Progress page, framed as progress. It carries a FIRST NAME only (never a surname, photo, phone
 * or guardian name), so the same shape is safe to show on a shared link.
 */
export type ProgressCardDto = {
  firstName: string;
  tenantName: string;
  weekStart: string;
  weekEnd: string;
  level: { name: string; nextName: string | null; progressPercent: number | null } | null;
  attendance: { attended: number; held: number; excused: number; percent: number | null };
  streak: { currentDays: number; longestDays: number };
  goals: { title: string; progressPercent: number; achieved: boolean }[];
  coachNote: string | null;
};

export type ProgressNoteDto = { memberId: string; weekStart: string; note: string | null; updatedAt: string | null };

export type ProgressCardLinkDto = {
  id: string;
  memberId: string;
  weekStart: string;
  status: "active" | "revoked" | "expired";
  expiresAt: string;
  createdAt: string;
};
export type CreatedProgressCardLinkDto = ProgressCardLinkDto & { token: string; path: string };

/** Week from `?week=` or the body: a Monday, not in the future. Default: this week's Monday. */
function resolveWeek(raw: unknown, today: string, field = "week"): string {
  const current = mondayOf(today);
  if (raw === undefined || raw === null || raw === "") return current;
  const p = new Problems();
  if (!isDateString(raw)) p.add(field, "Date YYYY-MM-DD (a Monday)");
  else if (!isMonday(raw)) p.add(field, "The week must start on a Monday");
  else if (raw > current) p.add(field, "A week that has not started yet has no card");
  p.throwIfAny();
  return raw as string;
}

/** Build the card. `p` must be allowed to view the member (checked by the caller). */
async function buildCard(db: TenantClient, p: Principal, memberId: string, weekStart: string, now: Date): Promise<ProgressCardDto> {
  const weekEnd = weekEndOf(weekStart);
  const [member, tenant, stats, goals, note] = await Promise.all([
    db.member.findFirst({ where: { id: memberId }, select: { displayName: true, guardian: { select: { name: true } } } }),
    db.tenant.findUnique({ where: { id: p.tenantId }, select: { name: true } }),
    getMemberStats(db, p, memberId, new URLSearchParams({ from: weekStart, to: weekEnd }), now),
    listGoals(db, p, memberId, new URLSearchParams()),
    db.progressNote.findFirst({ where: { memberId, weekStart: dateToDb(weekStart) }, select: { note: true } }),
  ]);
  if (!member) throw new ApiError("not_found", "Member not found");
  const clean = (text: string) => scrubNames(text, member.displayName, member.guardian?.name);
  const a = stats.attendance;
  const shown = goals.items
    .filter((g) => g.status === "active" || g.status === "achieved")
    .slice(0, MAX_CARD_GOALS)
    .map((g) => ({ title: clean(g.title), progressPercent: g.progressPercent, achieved: g.status === "achieved" }));
  return {
    firstName: firstNameOf(member.displayName),
    tenantName: tenant?.name ?? "",
    weekStart,
    weekEnd,
    level: stats.level ? { name: stats.level.name, nextName: stats.level.nextName, progressPercent: stats.level.progressPercent } : null,
    attendance: { attended: a.attended, held: a.attended + a.missed + a.excused, excused: a.excused, percent: a.percent },
    streak: { currentDays: stats.streaks.currentActiveDays, longestDays: stats.streaks.longestActiveDays },
    goals: shown,
    coachNote: note?.note ? clean(note.note) || null : null,
  };
}

/** GET /members/{memberId}/progress-card (getProgressCard). Own view; `week` is a Monday (default this week). */
export async function getProgressCard(db: TenantClient, p: Principal, memberId: string, params: URLSearchParams, now = new Date()) {
  await assertCanViewMember(db, p, memberId);
  const week = resolveWeek(params.get("week"), tenantDate(now));
  return buildCard(db, p, memberId, week, now);
}

/** GET /members/{memberId}/progress-card/note (getProgressNote): the coach's note as written, for editing. */
export async function getProgressNote(db: TenantClient, p: Principal, memberId: string, params: URLSearchParams, now = new Date()): Promise<ProgressNoteDto> {
  await assertCanManageMember(db, p, memberId);
  const week = resolveWeek(params.get("week"), tenantDate(now));
  const row = await db.progressNote.findFirst({ where: { memberId, weekStart: dateToDb(week) } });
  return { memberId, weekStart: week, note: row?.note ?? null, updatedAt: row?.updatedAt.toISOString() ?? null };
}

/** PUT /members/{memberId}/progress-card/note (saveProgressNote): create, replace or (empty text) remove the note for a week. */
export async function saveProgressNote(db: TenantClient, p: Principal, memberId: string, body: Record<string, unknown>, now = new Date()): Promise<ProgressNoteDto> {
  await assertCanManageMember(db, p, memberId);
  const problems = new Problems();
  for (const k of Object.keys(body)) if (k !== "week" && k !== "note") problems.add(k, "unknown field");
  let week = "";
  try {
    week = resolveWeek(body.week, tenantDate(now));
  } catch (err) {
    if (err instanceof ApiError && err.details) for (const d of err.details) problems.add(d.field, d.message);
    else throw err;
  }
  let note = "";
  if (typeof body.note !== "string") problems.add("note", `Text up to ${NOTE_MAX_LENGTH} characters (empty removes the note)`);
  else {
    note = body.note.trim();
    if (note.length > NOTE_MAX_LENGTH) problems.add("note", `Text up to ${NOTE_MAX_LENGTH} characters`);
  }
  problems.throwIfAny();

  const where = { memberId, weekStart: dateToDb(week) };
  const existing = await db.progressNote.findFirst({ where });
  if (note === "") {
    if (existing) await db.progressNote.delete({ where: { id: existing.id } });
    return { memberId, weekStart: week, note: null, updatedAt: null };
  }
  const row = existing
    ? await db.progressNote.update({ where: { id: existing.id }, data: { note, authorId: p.userId } })
    : await db.progressNote.create({ data: { tenantId: p.tenantId, ...where, note, authorId: p.userId } });
  return { memberId, weekStart: week, note: row.note, updatedAt: row.updatedAt.toISOString() };
}

type LinkRow = { id: string; memberId: string; weekStart: Date; expiresAt: Date; revokedAt: Date | null; createdAt: Date };

function linkDto(r: LinkRow, now: Date): ProgressCardLinkDto {
  return {
    id: r.id,
    memberId: r.memberId,
    weekStart: dateFromDb(r.weekStart),
    status: r.revokedAt ? "revoked" : r.expiresAt.getTime() <= now.getTime() ? "expired" : "active",
    expiresAt: r.expiresAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  };
}

/** GET /members/{memberId}/progress-card/links (listProgressCardLinks): live links, newest first. Never returns a token. */
export async function listProgressCardLinks(db: TenantClient, p: Principal, memberId: string, now = new Date()) {
  await assertCanViewMember(db, p, memberId);
  const rows = await db.progressCardLink.findMany({
    where: { memberId, revokedAt: null, expiresAt: { gt: now } },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: MAX_LIVE_LINKS + 5,
  });
  return { items: rows.map((r) => linkDto(r, now)) };
}

/**
 * POST /members/{memberId}/progress-card/links (createProgressCardLink). Returns the one-time token and the
 * same-origin path `/card/{token}`; only a hash is stored, so the link cannot be shown again later.
 */
export async function createProgressCardLink(db: TenantClient, p: Principal, memberId: string, body: Record<string, unknown>, now = new Date()): Promise<CreatedProgressCardLinkDto> {
  await assertCanViewMember(db, p, memberId);
  const week = resolveWeek(body.week, tenantDate(now));
  const live = await db.progressCardLink.count({ where: { memberId, revokedAt: null, expiresAt: { gt: now } } });
  if (live >= MAX_LIVE_LINKS) throw new ApiError("conflict", `At most ${MAX_LIVE_LINKS} shared links at a time: revoke one first`);
  const token = newToken();
  const row = await db.progressCardLink.create({
    data: { tenantId: p.tenantId, memberId, weekStart: dateToDb(week), tokenHash: hashToken(token), createdById: p.userId, expiresAt: linkExpiry(now) },
  });
  return { ...linkDto(row, now), token, path: `/card/${token}` };
}

/** POST /progress-card-links/{linkId}/revoke (revokeProgressCardLink). Safe to repeat. */
export async function revokeProgressCardLink(db: TenantClient, p: Principal, linkId: string, now = new Date()): Promise<ProgressCardLinkDto> {
  const row = await db.progressCardLink.findFirst({ where: { id: linkId } });
  if (!row) throw new ApiError("not_found", "Shared link not found");
  const visible = await db.progressCardLink.findFirst({ where: { id: linkId, member: memberWhere(p) }, select: { id: true } });
  if (!visible) throw new ApiError("forbidden", "This shared link is outside your own view");
  if (row.revokedAt) return linkDto(row, now);
  return linkDto(await db.progressCardLink.update({ where: { id: linkId }, data: { revokedAt: now } }), now);
}

/**
 * GET /progress-cards/{token} (getSharedProgressCard): PUBLIC. The token is the only credential, so every
 * failure (malformed, unknown, revoked, expired) is the same 404. The tenant comes from the link row, never
 * from the request. It reads with a system principal of the link's tenant and returns the same
 * first-name-only card; no other data of the member is reachable from here.
 */
export async function getSharedProgressCard(prisma: PrismaClient, token: string, now = new Date()): Promise<ProgressCardDto> {
  return (await loadSharedCard(prisma, token, now)).card;
}

/** Same as getSharedProgressCard, plus the link's tenant so the public page can apply that business's own theme. */
export async function loadSharedCard(prisma: PrismaClient, token: string, now = new Date()): Promise<{ card: ProgressCardDto; tenantId: string }> {
  const notFound = () => new ApiError("not_found", "This card link is not available");
  if (!TOKEN_PATTERN.test(token)) throw notFound();
  const link = await prisma.progressCardLink.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!link || link.revokedAt || link.expiresAt.getTime() <= now.getTime()) throw notFound();
  const db = forTenant(prisma, link.tenantId);
  const system: Principal = { userId: link.createdById, tenantId: link.tenantId, role: "owner" };
  return { card: await buildCard(db, system, link.memberId, dateFromDb(link.weekStart), now), tenantId: link.tenantId };
}

export { LINK_LIFETIME_DAYS };
