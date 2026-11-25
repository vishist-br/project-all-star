import { assertCanViewMember } from "../auth/access";
import { ApiError } from "../auth/errors";
import type { Principal } from "../auth/principal";
import type { TenantClient } from "../tenant-scope";
import { Problems, dateFromDb, dateToDb, isDateString, isRecord, textField } from "../workouts/validate";
import { dateParam, tenantDate } from "./pagination";

/** Optional decimal field with one decimal place, within [min, max]. */
function decimalField(p: Problems, body: Record<string, unknown>, key: string, min: number, max: number): number | null {
  const v = body[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) {
    p.add(key, `Number ${min}..${max}`);
    return null;
  }
  return Math.round(v * 10) / 10;
}

export type MeasurementInput = {
  measuredOn: string;
  weightKg: number;
  bodyFatPct: number | null;
  chestCm: number | null;
  waistCm: number | null;
  hipCm: number | null;
  armCm: number | null;
  thighCm: number | null;
  note: string | null;
};

/** Shape and range checks from the contract (BodyMeasurementInput). `today` is the tenant date: no entries in the future. */
export function parseMeasurementInput(body: unknown, today: string): MeasurementInput {
  if (!isRecord(body)) throw new ApiError("validation_failed", "Body must be a JSON object");
  const v = new Problems();
  let measuredOn = today;
  if (body.measuredOn !== undefined && body.measuredOn !== null) {
    if (!isDateString(body.measuredOn)) v.add("measuredOn", "Date YYYY-MM-DD");
    else if (body.measuredOn > today) v.add("measuredOn", "Not in the future");
    else if (body.measuredOn < "2000-01-01") v.add("measuredOn", "2000-01-01 or later");
    else measuredOn = body.measuredOn;
  }
  const weight = decimalField(v, body, "weightKg", 10, 400);
  if (weight === null && !v.list.some((e) => e.field === "weightKg")) v.add("weightKg", "Required, a number of kg");
  const out: MeasurementInput = {
    measuredOn,
    weightKg: weight ?? 0,
    bodyFatPct: decimalField(v, body, "bodyFatPct", 2, 70),
    chestCm: decimalField(v, body, "chestCm", 20, 250),
    waistCm: decimalField(v, body, "waistCm", 20, 250),
    hipCm: decimalField(v, body, "hipCm", 20, 250),
    armCm: decimalField(v, body, "armCm", 10, 100),
    thighCm: decimalField(v, body, "thighCm", 15, 150),
    note: textField(v, body, "note", "", 280),
  };
  v.throwIfAny();
  return out;
}

type Row = {
  id: string;
  memberId: string;
  measuredOn: Date;
  weightKg: { toString(): string };
  bodyFatPct: { toString(): string } | null;
  chestCm: { toString(): string } | null;
  waistCm: { toString(): string } | null;
  hipCm: { toString(): string } | null;
  armCm: { toString(): string } | null;
  thighCm: { toString(): string } | null;
  note: string | null;
  createdAt: Date;
};
const num = (d: { toString(): string } | null) => (d === null ? null : Number(d.toString()));

export function measurementDto(r: Row) {
  return {
    id: r.id,
    memberId: r.memberId,
    measuredOn: dateFromDb(r.measuredOn),
    weightKg: num(r.weightKg) as number,
    bodyFatPct: num(r.bodyFatPct),
    chestCm: num(r.chestCm),
    waistCm: num(r.waistCm),
    hipCm: num(r.hipCm),
    armCm: num(r.armCm),
    thighCm: num(r.thighCm),
    note: r.note,
    createdAt: r.createdAt.toISOString(),
  };
}

/**
 * GET /members/{memberId}/body-measurements (listBodyMeasurements). Oldest first (chart order), optional
 * `from` / `to`. Weight is personal data: the member, their guardian, and the member's coach and owner only.
 */
export async function listBodyMeasurements(db: TenantClient, p: Principal, memberId: string, params: URLSearchParams) {
  await assertCanViewMember(db, p, memberId);
  const from = params.get("from");
  const to = params.get("to");
  dateParam(params, "from");
  dateParam(params, "to");
  const rows = await db.bodyMeasurement.findMany({
    where: { memberId, ...(from || to ? { measuredOn: { ...(from ? { gte: dateToDb(from) } : {}), ...(to ? { lte: dateToDb(to) } : {}) } } : {}) },
    orderBy: [{ measuredOn: "asc" }, { id: "asc" }],
    take: 500,
  });
  const items = rows.map(measurementDto);
  return { memberId, items, latest: items.length ? items[items.length - 1] : null };
}

/** POST /members/{memberId}/body-measurements (recordBodyMeasurement). One entry per day: a second one for the same day replaces it. */
export async function recordBodyMeasurement(db: TenantClient, p: Principal, memberId: string, body: unknown, now = new Date()) {
  const input = parseMeasurementInput(body, tenantDate(now));
  await assertCanViewMember(db, p, memberId);
  const data = {
    weightKg: input.weightKg,
    bodyFatPct: input.bodyFatPct,
    chestCm: input.chestCm,
    waistCm: input.waistCm,
    hipCm: input.hipCm,
    armCm: input.armCm,
    thighCm: input.thighCm,
    note: input.note,
    recordedById: p.userId,
  };
  const measuredOn = dateToDb(input.measuredOn);
  const existing = await db.bodyMeasurement.findFirst({ where: { memberId, measuredOn }, select: { id: true } });
  const row = existing
    ? await db.bodyMeasurement.update({ where: { id: existing.id }, data })
    : await db.bodyMeasurement.create({ data: { ...data, memberId, measuredOn } as never });
  return measurementDto(row);
}

/** DELETE /members/{memberId}/body-measurements/{measurementId} (deleteBodyMeasurement). 204. */
export async function deleteBodyMeasurement(db: TenantClient, p: Principal, memberId: string, measurementId: string): Promise<void> {
  await assertCanViewMember(db, p, memberId);
  const row = await db.bodyMeasurement.findFirst({ where: { id: measurementId, memberId }, select: { id: true } });
  if (!row) throw new ApiError("not_found", "Measurement not found");
  await db.bodyMeasurement.deleteMany({ where: { id: measurementId } });
}
