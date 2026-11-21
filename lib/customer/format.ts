import type { Locale } from "../i18n";

const TZ = "Asia/Kolkata";
const TAG: Record<Locale, string> = { en: "en-IN", hi: "hi-IN", kn: "kn-IN" };

/** "Sat, 21 Nov" for a plain date (YYYY-MM-DD). */
export function formatDay(date: string, locale: Locale): string {
  return new Intl.DateTimeFormat(TAG[locale], { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

/** "9:30 am" in the business timezone. */
export function formatTime(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(TAG[locale], { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

/** "Sat, 21 Nov, 9:30 am" in the business timezone. */
export function formatWhen(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(TAG[locale], {
    timeZone: TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** "1 min", "45 sec" (localised units). */
export function formatSeconds(seconds: number, locale: Locale): string {
  const mins = seconds / 60;
  const useMin = seconds >= 60 && Number.isInteger(mins);
  return new Intl.NumberFormat(TAG[locale], {
    style: "unit",
    unit: useMin ? "minute" : "second",
    unitDisplay: "short",
  }).format(useMin ? mins : seconds);
}
