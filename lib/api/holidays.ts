import { ApiError } from "../auth/errors";
import type { TenantClient } from "../tenant-scope";
import { dateFromDb, dateToDb, isDateString, Problems } from "../workouts/validate";
import { pageArgs, toPage } from "./pagination";

export type HolidayDto = { id: string; date: string; name: string };

const NAME_MAX = 80;

const toDto = (h: { id: string; date: Date; name: string }): HolidayDto => ({ id: h.id, date: dateFromDb(h.date), name: h.name });

/** GET /holidays (listHolidays): the tenant's holiday and closure days, oldest first. Optional `from` / `to` (inclusive). */
export async function listHolidays(db: TenantClient, params: URLSearchParams) {
  const p = new Problems();
  const range: { gte?: Date; lte?: Date } = {};
  for (const [key, bound] of [["from", "gte"], ["to", "lte"]] as const) {
    const v = params.get(key);
    if (v === null || v === "") continue;
    if (!isDateString(v)) p.add(key, "Date YYYY-MM-DD");
    else range[bound] = dateToDb(v);
  }
  p.throwIfAny("Query is not valid");
  const { limit, args } = pageArgs(params);
  const rows = await db.holiday.findMany({
    where: range.gte || range.lte ? { date: range } : {},
    orderBy: [{ date: "asc" }, { id: "asc" }],
    ...args,
  });
  const page = toPage(rows, limit);
  return { items: page.rows.map(toDto), nextCursor: page.nextCursor };
}

/** POST /holidays (createHoliday): one calendar day per tenant; a second entry for the same date is a 409. */
export async function createHoliday(db: TenantClient, tenantId: string, body: Record<string, unknown>): Promise<HolidayDto> {
  const p = new Problems();
  for (const k of Object.keys(body)) if (k !== "date" && k !== "name") p.add(k, "unknown field");
  const date = body.date;
  const name = typeof body.name === "string" ? body.name.trim() : body.name;
  if (!isDateString(date)) p.add("date", "Date YYYY-MM-DD");
  if (typeof name !== "string" || name.length < 1 || name.length > NAME_MAX) p.add("name", `Text 1..${NAME_MAX} characters`);
  p.throwIfAny();
  const day = dateToDb(date as string);
  if (await db.holiday.findFirst({ where: { date: day }, select: { id: true } })) {
    throw new ApiError("conflict", "A holiday already exists on this date");
  }
  try {
    return toDto(await db.holiday.create({ data: { tenantId, date: day, name: name as string } }));
  } catch (err) {
    // Lost a race with a parallel create for the same date (unique tenant + date).
    if ((err as { code?: string }).code === "P2002") throw new ApiError("conflict", "A holiday already exists on this date");
    throw err;
  }
}

/** DELETE /holidays/{holidayId} (deleteHoliday). Another tenant's id is a 404. */
export async function deleteHoliday(db: TenantClient, holidayId: string): Promise<void> {
  const row = await db.holiday.findFirst({ where: { id: holidayId }, select: { id: true } });
  if (!row) throw new ApiError("not_found", "Holiday not found");
  await db.holiday.deleteMany({ where: { id: holidayId } });
}
