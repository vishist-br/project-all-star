import type { RosterRow } from "../offline/rollcall";

/** SessionDetail as the API returns it (contract v0.2.0), as far as the coach screens use it. */
export type SessionDetail = {
  id: string;
  batchId: string;
  batchName: string;
  coachId: string;
  coachName: string;
  venueId: string;
  venueName: string;
  startsAt: string;
  endsAt: string;
  status: "scheduled" | "completed" | "cancelled";
  attendanceSummary: { present: number; absent: number; excused: number; total: number } | null;
  coachNote: string | null;
  kind: "group_class" | "one_on_one";
  title: string | null;
  capacity: number | null;
  bookedCount: number;
  waitlistCount: number;
  isHoliday: boolean;
  cancelReason: string | null;
  warnings?: SessionWarning[];
  roster?: RosterRow[];
};

export type SessionWarning = { code: "outside_availability" | "over_capacity" | "on_holiday"; message: string };

export type BatchOption = { id: string; name: string; capacity: number | null };
export type MemberChoice = { id: string; name: string };
