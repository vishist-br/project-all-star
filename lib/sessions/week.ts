/** Calendar helpers. Every POC tenant runs on Asia/Kolkata (UTC+05:30, no daylight saving). */
const IST_MS = 330 * 60_000;
const DAY = 86_400_000;

export const TZ = "Asia/Kolkata";

/** Tenant-calendar date (YYYY-MM-DD) of an instant. */
export function istDate(d: Date | string): string {
  return new Date(new Date(d).getTime() + IST_MS).toISOString().slice(0, 10);
}

/** Tenant-local clock time (HH:mm) of an instant. */
export function istTime(d: Date | string): string {
  return new Date(new Date(d).getTime() + IST_MS).toISOString().slice(11, 16);
}

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}

/** ISO weekday of a date: Monday = 1 .. Sunday = 7. */
export function isoWeekday(date: string): number {
  const w = new Date(`${date}T00:00:00Z`).getUTCDay();
  return w === 0 ? 7 : w;
}

/** The Monday of the week that holds `date`. */
export function mondayOf(date: string): string {
  return addDays(date, 1 - isoWeekday(date));
}

export function isDateString(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);
}

export function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** Local date + HH:mm to the ISO instant the API wants. */
export function toInstant(date: string, time: string): string {
  return new Date(`${date}T${time}:00+05:30`).toISOString();
}

export function groupByDate<T extends { startsAt: string }>(items: readonly T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of [...items].sort((a, b) => a.startsAt.localeCompare(b.startsAt))) {
    const key = istDate(item.startsAt);
    out.set(key, [...(out.get(key) ?? []), item]);
  }
  return out;
}

export function formatDay(date: string, locale: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }): string {
  return new Date(`${date}T12:00:00+05:30`).toLocaleDateString(locale === "en" ? "en-IN" : locale, { ...opts, timeZone: TZ });
}
