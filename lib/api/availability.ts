import { ApiError } from "../auth/errors";
import type { Principal } from "../auth/principal";
import type { TenantClient } from "../tenant-scope";

const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

type SlotRow = { id: string; weekday: number; startTime: string; endTime: string; venueId: string | null };
const slotSelect = { id: true, weekday: true, startTime: true, endTime: true, venueId: true } as const;

function toDto(coachId: string, rows: SlotRow[]) {
  const slots = [...rows]
    .sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime) || a.id.localeCompare(b.id))
    .map((r) => ({ id: r.id, weekday: r.weekday, startTime: r.startTime, endTime: r.endTime, venueId: r.venueId }));
  return { coachId, slots };
}

/** 404 outside the tenant (or not a coach), 403 for a coach asking about another coach. */
async function assertCoachAccess(db: TenantClient, p: Principal, coachId: string) {
  const coach = await db.user.findFirst({ where: { id: coachId, role: "COACH" }, select: { id: true } });
  if (!coach) throw new ApiError("not_found", "Coach not found");
  if (p.role === "coach" && coachId !== p.userId) {
    throw new ApiError("forbidden", "Coaches can only manage their own availability");
  }
}

/** GET /coaches/{coachId}/availability (listCoachAvailability). */
export async function listCoachAvailability(db: TenantClient, p: Principal, coachId: string) {
  await assertCoachAccess(db, p, coachId);
  const rows = await db.coachAvailability.findMany({ where: { coachId }, select: slotSelect });
  return toDto(coachId, rows);
}

type ParsedSlot = { weekday: number; startTime: string; endTime: string; venueId: string | null };

function fail(field: string, message: string): never {
  throw new ApiError("validation_failed", `${field}: ${message}`, [{ field, message }]);
}

function parseSlots(body: Record<string, unknown>): ParsedSlot[] {
  const slots = body.slots;
  if (!Array.isArray(slots)) return fail("slots", "array required");
  if (slots.length > 50) return fail("slots", "at most 50 slots");
  const out: ParsedSlot[] = [];
  slots.forEach((raw, i) => {
    const f = (n: string) => `slots[${i}].${n}`;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return fail(`slots[${i}]`, "object required");
    const s = raw as Record<string, unknown>;
    if (typeof s.weekday !== "number" || !Number.isInteger(s.weekday) || s.weekday < 1 || s.weekday > 7) {
      fail(f("weekday"), "integer 1..7");
    }
    if (typeof s.startTime !== "string" || !TIME.test(s.startTime)) fail(f("startTime"), "HH:mm required");
    if (typeof s.endTime !== "string" || !TIME.test(s.endTime)) fail(f("endTime"), "HH:mm required");
    if ((s.startTime as string) >= (s.endTime as string)) fail(f("endTime"), "must be after startTime");
    if (s.venueId !== undefined && s.venueId !== null && (typeof s.venueId !== "string" || s.venueId.length === 0)) {
      fail(f("venueId"), "string or null");
    }
    out.push({
      weekday: s.weekday as number,
      startTime: s.startTime as string,
      endTime: s.endTime as string,
      venueId: (s.venueId as string | null | undefined) ?? null,
    });
  });
  // Slots on one weekday may touch (09:00 end, 09:00 start) but not overlap.
  const details: { field: string; message: string }[] = [];
  out.forEach((a, i) => {
    out.forEach((b, j) => {
      if (j > i && a.weekday === b.weekday && a.startTime < b.endTime && b.startTime < a.endTime) {
        details.push({ field: `slots[${j}]`, message: `overlaps slots[${i}] on weekday ${a.weekday}` });
      }
    });
  });
  if (details.length) throw new ApiError("validation_failed", "Availability slots must not overlap on one weekday", details);
  return out;
}

/** PUT /coaches/{coachId}/availability (replaceCoachAvailability): replaces all slots atomically. */
export async function replaceCoachAvailability(db: TenantClient, p: Principal, coachId: string, body: Record<string, unknown>) {
  await assertCoachAccess(db, p, coachId);
  const slots = parseSlots(body);
  const venueIds = [...new Set(slots.map((s) => s.venueId).filter((v): v is string => v !== null))];
  if (venueIds.length) {
    const found = await db.venue.findMany({ where: { id: { in: venueIds } }, select: { id: true } });
    const ok = new Set(found.map((v) => v.id));
    const details = slots.flatMap((s, i) =>
      s.venueId !== null && !ok.has(s.venueId) ? [{ field: `slots[${i}].venueId`, message: "unknown venue" }] : [],
    );
    if (details.length) throw new ApiError("validation_failed", "Unknown venue", details);
  }
  const rows = await db.$transaction(async (tx) => {
    await tx.coachAvailability.deleteMany({ where: { coachId } });
    if (slots.length) {
      await tx.coachAvailability.createMany({ data: slots.map((s) => ({ tenantId: p.tenantId, coachId, ...s })) });
    }
    return tx.coachAvailability.findMany({ where: { coachId }, select: slotSelect });
  });
  return toDto(coachId, rows);
}
