import type { ExcuseReason, MarkStatus, QueueItem } from "./queue";

export type Attendance = MarkStatus | "not_marked";
export type Sync = "synced" | "queued" | "conflict" | "failed";

export type RosterRow = {
  memberId: string;
  memberName: string;
  source: "enrolled" | "booked" | "waitlisted";
  attendance: Attendance;
  excusedReason: ExcuseReason | null;
  note: string | null;
  attendanceClientId: string | null;
};

export type RowView = RosterRow & {
  /** Where the shown value comes from: the server, or a tap still on this device. */
  sync: Sync;
  /** True when this page just sent the value to the server (shows "Saved"). */
  justSaved: boolean;
  /** Waitlisted members are not on the roll call. */
  tappable: boolean;
};

/** One tap: unmarked or absent becomes present, present becomes absent, excused goes back to present. */
export function nextStatus(current: Attendance): MarkStatus {
  return current === "present" ? "absent" : "present";
}

/**
 * Overlays the marks that live on this device on the server roster. A waiting mark wins over the
 * server value; a refused (conflict/failed) one is shown as the server value with a problem flag.
 * `recentlySynced` holds marks this page already sent successfully.
 */
export function mergeRoster(
  roster: readonly RosterRow[],
  sessionId: string,
  queue: readonly QueueItem[],
  recentlySynced: ReadonlyMap<string, QueueItem> = new Map(),
): RowView[] {
  const mine = new Map(queue.filter((q) => q.sessionId === sessionId).map((q) => [q.memberId, q]));
  return roster.map((r) => {
    const base = { ...r, tappable: r.source !== "waitlisted", justSaved: false };
    const q = mine.get(r.memberId);
    if (q && q.state === "queued") {
      return { ...base, attendance: q.status, excusedReason: q.reason, note: q.note, attendanceClientId: q.clientId, sync: "queued" as const };
    }
    if (q) return { ...base, sync: q.state };
    const s = recentlySynced.get(r.memberId);
    if (s) return { ...base, attendance: s.status, excusedReason: s.reason, note: s.note, attendanceClientId: s.clientId, sync: "synced" as const, justSaved: true };
    return { ...base, sync: "synced" as const };
  });
}

export function summarize(rows: readonly RowView[]) {
  const s = { present: 0, absent: 0, excused: 0, notMarked: 0 };
  for (const r of rows) {
    if (!r.tappable) continue;
    if (r.attendance === "not_marked") s.notMarked += 1;
    else s[r.attendance] += 1;
  }
  return s;
}

/** Marked, tappable rows that are saved on the server (everything except waiting or refused taps). */
export function markedRows(rows: readonly RowView[]) {
  return rows.filter((r) => r.tappable && r.attendance !== "not_marked" && r.attendanceClientId);
}

export type CompleteCheck = "ok" | "nothingMarked" | "waiting" | "problems";

/** Complete needs at least one mark (the API takes 1..200 entries), and nothing still waiting or refused. */
export function canComplete(rows: readonly RowView[]): CompleteCheck {
  if (rows.some((r) => r.sync === "queued")) return "waiting";
  if (rows.some((r) => r.sync === "conflict" || r.sync === "failed")) return "problems";
  return markedRows(rows).length === 0 ? "nothingMarked" : "ok";
}
