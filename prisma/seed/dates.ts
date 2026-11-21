// Date and deterministic-random helpers for the demo seed. Dates are "YYYY-MM-DD" strings
// in the venue timezone (Asia/Kolkata). Nothing here reads the database.

const DAY = 86_400_000;

/** Anchor "today": SEED_TODAY (YYYY-MM-DD) if set, otherwise today in Asia/Kolkata. */
export function seedToday(env: Record<string, string | undefined> = process.env): string {
  const v = env.SEED_TODAY;
  if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

export const addDays = (d: string, n: number): string =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

export const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

/** ISO weekday, Monday = 1 .. Sunday = 7. */
export function isoDow(d: string): number {
  const w = new Date(`${d}T00:00:00Z`).getUTCDay();
  return w === 0 ? 7 : w;
}

export const dbDate = (d: string): Date => new Date(`${d}T00:00:00.000Z`);
export const istAt = (d: string, hhmm: string): Date => new Date(`${d}T${hhmm}:00+05:30`);

export function addMinutesHHmm(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const t = Math.max(0, Math.min(23 * 60 + 59, h * 60 + m + minutes));
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

/** Deterministic pseudo-random number in [0, 1) from the given parts. */
export function rnd(...parts: (string | number)[]): number {
  const s = parts.join("|");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
