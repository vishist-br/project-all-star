import type { HolidayDto } from "@/lib/api/holidays";

export const NAME_MAX = 80;

export type HolidayForm = { date: string; name: string };
export type HolidayError = "dateRequired" | "dateInvalid" | "nameRequired" | "nameLong";

/** Client-side check that mirrors createHoliday, so the owner sees the problem before a round trip. */
export function validateHoliday(input: HolidayForm): { ok: true; value: HolidayForm } | { ok: false; errors: Partial<Record<"date" | "name", HolidayError>> } {
  const errors: Partial<Record<"date" | "name", HolidayError>> = {};
  const date = input.date.trim();
  const name = input.name.trim();
  if (!date) errors.date = "dateRequired";
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) errors.date = "dateInvalid";
  if (!name) errors.name = "nameRequired";
  else if (name.length > NAME_MAX) errors.name = "nameLong";
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: { date, name } };
}

/** Upcoming days first (soonest first), then past days (most recent first). `today` is YYYY-MM-DD. */
export function splitHolidays(items: readonly HolidayDto[], today: string): { upcoming: HolidayDto[]; past: HolidayDto[] } {
  const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date));
  return { upcoming: sorted.filter((h) => h.date >= today), past: sorted.filter((h) => h.date < today).reverse() };
}

/** Insert keeping date order and replacing nothing; used for the optimistic list after a successful add. */
export function withHoliday(items: readonly HolidayDto[], h: HolidayDto): HolidayDto[] {
  return [...items.filter((x) => x.id !== h.id), h].sort((a, b) => a.date.localeCompare(b.date));
}
