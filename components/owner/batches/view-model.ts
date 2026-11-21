/** Pure helpers for the owner Batches page: filter options, capacity bar and schedule text. */

export type BatchLike = { sportId: string; sportName: string; venueId: string; venueName: string };
export type Option = { id: string; name: string };

/** Distinct, name-sorted venue and sport options taken from the unfiltered batch list. */
export function filterOptions(batches: BatchLike[]): { venues: Option[]; sports: Option[] } {
  const venues = new Map<string, string>();
  const sports = new Map<string, string>();
  for (const b of batches) {
    venues.set(b.venueId, b.venueName);
    sports.set(b.sportId, b.sportName);
  }
  const list = (m: Map<string, string>) => [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return { venues: list(venues), sports: list(sports) };
}

/** Accepts a filter only when it is one of the known ids, so a stale or odd URL falls back to "all". */
export function pickFilter(value: string | string[] | undefined, options: Option[]): string | undefined {
  return typeof value === "string" && options.some((o) => o.id === value) ? value : undefined;
}

export type Fill = { percent: number | null; full: boolean; open: number | null };

/** Members against capacity. No capacity means no bar (null percent). */
export function fill(memberCount: number, capacity: number | null): Fill {
  if (!capacity || capacity <= 0) return { percent: null, full: false, open: null };
  return { percent: Math.min(100, Math.round((memberCount / capacity) * 100)), full: memberCount >= capacity, open: Math.max(0, capacity - memberCount) };
}

export type SchedulePart = { weekday: number; startTime: string; endTime: string };

/** Weekdays in order plus the time range of the first entry. Null when the batch has no weekly schedule. */
export function summariseSchedule(schedule: SchedulePart[]): { weekdays: number[]; time: string } | null {
  if (schedule.length === 0) return null;
  const weekdays = [...new Set(schedule.map((s) => s.weekday))].sort((a, b) => a - b);
  return { weekdays, time: `${schedule[0].startTime}–${schedule[0].endTime}` };
}
