import { cache } from "react";
import type { TenantClient } from "../tenant-scope";
import { holidayDates } from "./member-stats";
import { addDays, loadScheduledEntries, type ScheduledEntry } from "./schedule";

/**
 * STAR-102: several panels of one page (owner dashboard: overview, trends, insights, coach workload)
 * read overlapping windows of the same tenant data. These loaders read one wide window once per
 * request (React `cache`, which only memoises inside a server render, so API routes and tests that
 * mutate between reads always see fresh data) and hand every caller its own slice.
 */
const WIDE_DAYS = 90;

const wideHolidays = cache((db: TenantClient, today: string) => holidayDates(db, addDays(today, -WIDE_DAYS), today));
const wideEntries = cache((db: TenantClient, today: string, memberKey: string) =>
  loadScheduledEntries(db, memberKey.split(","), addDays(today, -WIDE_DAYS), today),
);

/** Holiday dates in [from, to]; `today` anchors the shared window (a range outside it is read directly). */
export async function sharedHolidayDates(db: TenantClient, today: string, from: string, to: string): Promise<Set<string>> {
  if (from < addDays(today, -WIDE_DAYS) || to > today) return holidayDates(db, from, to);
  return new Set([...(await wideHolidays(db, today))].filter((d) => d >= from && d <= to));
}

/**
 * Scheduled entries of `memberIds` in [from, to]. The wide window is loaded once for `allMemberIds`
 * (the whole roster), so every caller on a page must pass the same roster; `memberIds` is the subset it wants.
 * A window outside the shared one is read directly.
 */
export async function sharedScheduledEntries(
  db: TenantClient,
  today: string,
  allMemberIds: readonly string[],
  memberIds: readonly string[],
  from: string,
  to: string,
): Promise<ScheduledEntry[]> {
  if (memberIds.length === 0 || allMemberIds.length === 0) return [];
  if (from < addDays(today, -WIDE_DAYS) || to > today) return loadScheduledEntries(db, [...memberIds], from, to);
  const all = await wideEntries(db, today, [...allMemberIds].sort().join(","));
  const wanted = memberIds.length === allMemberIds.length ? null : new Set(memberIds);
  return all.filter((e) => e.date >= from && e.date <= to && (!wanted || wanted.has(e.memberId)));
}
