import { expandPlanDay } from "../workouts/supersets";

/** Pure view-model helpers for the coach send screen (no browser or database APIs). */

export const NOTE_MAX = 280;
export const MAX_MEMBERS = 100;

type ItemLite = {
  position?: number;
  sets: number | null;
  reps: number | null;
  durationSeconds: number | null;
  restSeconds: number | null;
  supersetGroup: string | null;
  rounds: number | null;
  targetDistanceMeters?: number | null;
};
type DayLite = { items: ItemLite[] };

const DEFAULT_SETS = 3;
const SECONDS_PER_REP = 3;
const DEFAULT_REST = 45;

/** Seconds of work for one set of an item (time, distance or reps). */
function workSeconds(i: ItemLite): number {
  if (i.durationSeconds) return i.durationSeconds;
  if (i.targetDistanceMeters) return Math.max(30, Math.round(i.targetDistanceMeters / 1.5));
  return (i.reps ?? 10) * SECONDS_PER_REP;
}

function ordered(items: ItemLite[]) {
  return items.map((it, i) => ({ ...it, position: it.position ?? i }));
}

/** Rough minutes of one plan day: sets (or rounds of a superset) of work plus rest. Rounded up to 5 minutes. */
export function estimateDayMinutes(items: ItemLite[]): number {
  let seconds = 0;
  for (const block of expandPlanDay(ordered(items))) {
    if (block.type === "single") {
      const i = block.items[0]!;
      const sets = i.sets ?? DEFAULT_SETS;
      seconds += sets * (workSeconds(i) + (i.restSeconds ?? DEFAULT_REST));
    } else {
      const rounds = block.rounds ?? block.items[0]!.sets ?? DEFAULT_SETS;
      const work = block.items.reduce((n, i) => n + workSeconds(i), 0);
      const rest = Math.max(...block.items.map((i) => i.restSeconds ?? DEFAULT_REST));
      seconds += rounds * (work + rest);
    }
  }
  if (seconds === 0) return 0;
  return Math.max(5, Math.ceil(seconds / 60 / 5) * 5);
}

export type PlanSummary = { exercises: number; supersets: number; minutes: number; days: number };

/** "4 exercises, 1 superset, about 45 min": figures of the busiest day, plus how many days the plan has. */
export function summarizePlan(days: DayLite[]): PlanSummary {
  const live = days.filter((d) => d.items.length > 0);
  let best: DayLite | null = null;
  for (const d of live) if (!best || d.items.length > best.items.length) best = d;
  if (!best) return { exercises: 0, supersets: 0, minutes: 0, days: 0 };
  const supersets = expandPlanDay(ordered(best.items)).filter((b) => b.type === "superset").length;
  return { exercises: best.items.length, supersets, minutes: estimateDayMinutes(best.items), days: live.length };
}

export type MemberRow = { id: string; name: string; level: string | null; batchIds: string[] };
export type BatchRow = { id: string; name: string };
export type MemberGroup = { id: string; name: string; members: MemberRow[] };

export const OTHER_GROUP = "__other";

/** Members grouped by their first batch (in the batch order given); members with no listed batch go last. Name search is case-insensitive. */
export function groupMembers(members: readonly MemberRow[], batches: readonly BatchRow[], query = ""): MemberGroup[] {
  const q = query.trim().toLowerCase();
  const match = (m: MemberRow) => !q || m.name.toLowerCase().includes(q);
  const groups: MemberGroup[] = batches.map((b) => ({ id: b.id, name: b.name, members: [] }));
  const other: MemberGroup = { id: OTHER_GROUP, name: "", members: [] };
  for (const m of members) {
    if (!match(m)) continue;
    const first = batches.find((b) => m.batchIds.includes(b.id));
    if (first) groups.find((g) => g.id === first.id)!.members.push(m);
    else other.members.push(m);
  }
  return [...groups, other].filter((g) => g.members.length > 0);
}

export function toggleOne(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function groupAllSelected(selected: ReadonlySet<string>, g: MemberGroup): boolean {
  return g.members.length > 0 && g.members.every((m) => selected.has(m.id));
}

/** Select every member of a group, or clear the group when all are already selected. */
export function toggleGroup(selected: ReadonlySet<string>, g: MemberGroup): Set<string> {
  const next = new Set(selected);
  if (groupAllSelected(selected, g)) for (const m of g.members) next.delete(m.id);
  else for (const m of g.members) next.add(m.id);
  return next;
}

export function toggleEveryone(selected: ReadonlySet<string>, all: readonly MemberRow[]): Set<string> {
  return all.length > 0 && all.every((m) => selected.has(m.id)) ? new Set() : new Set(all.map((m) => m.id));
}

export type RepeatMode = "ongoing" | "once" | "weeks" | "until";
export type SendForm = { memberIds: string[]; startsOn: string; mode: RepeatMode; weeks: string; endsOn: string; note: string };
export type SendErrors = Partial<Record<"members" | "startsOn" | "weeks" | "endsOn" | "note", string>>;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Field problems as ids (the screen translates them). Empty when the form can be sent. */
export function validateSend(f: SendForm): SendErrors {
  const e: SendErrors = {};
  if (f.memberIds.length < 1) e.members = "members";
  else if (f.memberIds.length > MAX_MEMBERS) e.members = "tooMany";
  if (!DATE.test(f.startsOn)) e.startsOn = "date";
  if (f.note.length > NOTE_MAX) e.note = "tooLong";
  if (f.mode === "weeks") {
    const n = Number(f.weeks);
    if (!Number.isInteger(n) || n < 1 || n > 52) e.weeks = "weeks";
  }
  if (f.mode === "until") {
    if (!DATE.test(f.endsOn)) e.endsOn = "date";
    else if (DATE.test(f.startsOn) && f.endsOn < f.startsOn) e.endsOn = "before";
  }
  return e;
}

/** The body of sendPlanToMembers for a valid form. */
export function buildSendPayload(planId: string, f: SendForm) {
  const repeat =
    f.mode === "weeks" ? { mode: "weeks" as const, weeks: Number(f.weeks) } : f.mode === "until" ? { mode: "until" as const, endsOn: f.endsOn } : { mode: f.mode };
  return { planId, memberIds: [...new Set(f.memberIds)], startsOn: f.startsOn, repeat, ...(f.note.trim() ? { note: f.note.trim() } : {}) };
}

/** Last day of a repeat, for the preview line. Null when it keeps going or is not valid yet. */
export function repeatEnd(f: Pick<SendForm, "startsOn" | "mode" | "weeks" | "endsOn">): string | null {
  if (!DATE.test(f.startsOn)) return null;
  if (f.mode === "once") return f.startsOn;
  if (f.mode === "until") return DATE.test(f.endsOn) ? f.endsOn : null;
  if (f.mode === "weeks") {
    const n = Number(f.weeks);
    if (!Number.isInteger(n) || n < 1 || n > 52) return null;
    const d = new Date(`${f.startsOn}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n * 7 - 1);
    return d.toISOString().slice(0, 10);
  }
  return null;
}

export type SendStatus = "sent" | "already_sent" | "skipped_active";
export type MemberResult = { memberId: string; memberName: string; status: SendStatus; assignmentId: string };

export const STATUS_TONE: Record<SendStatus, "ok" | "info" | "warn"> = { sent: "ok", already_sent: "info", skipped_active: "warn" };

export function countResults(results: readonly MemberResult[]) {
  return {
    sent: results.filter((r) => r.status === "sent").length,
    already: results.filter((r) => r.status === "already_sent").length,
    skipped: results.filter((r) => r.status === "skipped_active").length,
  };
}

/** What members open from WhatsApp: the workouts page of the customer role. Contains no token or secret. */
export function memberLink(origin: string): string {
  return `${origin.replace(/\/+$/, "")}/customer/workouts`;
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** "Ravi Kumar" gives "Ravi"; seed names such as "Sample Coach Alpha" give "Alpha". Used in "New from Coach {name}". */
export function coachLabel(name: string | null | undefined): string {
  const cleaned = (name ?? "").trim().replace(/^sample\s+/i, "").replace(/^coach\s+/i, "");
  return firstName(cleaned);
}
