import { describe, expect, it } from "vitest";
import {
  buildAttendanceBody,
  buildBatches,
  classifyResult,
  enqueue,
  MAX_ATTEMPTS,
  pending,
  replayQueue,
  type QueueItem,
  type SendOutcome,
} from "../lib/offline/queue";
import { canComplete, mergeRoster, nextStatus, summarize, type RosterRow } from "../lib/offline/rollcall";
import { createQueueStore, parseQueue } from "../lib/offline/storage";

const T0 = new Date("2026-11-22T10:00:00Z");
let n = 0;
const at = (s: number) => new Date(T0.getTime() + s * 1000);
const mk = (queue: QueueItem[], sessionId: string, memberId: string, status: "present" | "absent" | "excused" = "present", sec = 0, reason?: "exam") =>
  enqueue(queue, { sessionId, memberId, status, reason }, { now: at(sec), clientId: `cid-${sessionId}-${memberId}-${(n += 1)}` });

describe("roll-call state cycling", () => {
  it("cycles unmarked -> present -> absent -> present, and excused goes back to present", () => {
    expect(nextStatus("not_marked")).toBe("present");
    expect(nextStatus("present")).toBe("absent");
    expect(nextStatus("absent")).toBe("present");
    expect(nextStatus("excused")).toBe("present");
  });
});

describe("queue ordering", () => {
  it("keeps tap order and replaces an older tap for the same member", () => {
    let q: QueueItem[] = [];
    q = mk(q, "s1", "a", "present", 1);
    q = mk(q, "s1", "b", "present", 2);
    q = mk(q, "s1", "a", "absent", 3); // a changed their mind
    expect(q.map((i) => `${i.memberId}:${i.status}`)).toEqual(["b:present", "a:absent"]);
  });

  it("groups by session in order of first waiting mark", () => {
    let q: QueueItem[] = [];
    q = mk(q, "s2", "a", "present", 1);
    q = mk(q, "s1", "a", "present", 2);
    q = mk(q, "s2", "b", "absent", 3);
    const batches = buildBatches(q);
    expect(batches.map((b) => b.sessionId)).toEqual(["s2", "s1"]);
    expect(batches[0].items.map((i) => i.memberId)).toEqual(["a", "b"]);
  });

  it("splits a session into requests of at most 200 marks", () => {
    let q: QueueItem[] = [];
    for (let i = 0; i < 205; i += 1) q = mk(q, "s1", `m${i}`, "present", i);
    const b = buildBatches(q);
    expect(b.map((x) => x.items.length)).toEqual([200, 5]);
  });

  it("only excused marks carry a reason, and notes are trimmed", () => {
    const q = enqueue([], { sessionId: "s", memberId: "m", status: "present", reason: "exam", note: "  hi  " }, { clientId: "cid-12345678" });
    expect(q[0].reason).toBeNull();
    expect(q[0].note).toBe("hi");
    const e = enqueue([], { sessionId: "s", memberId: "m", status: "excused", reason: "exam" }, { clientId: "cid-12345679" });
    expect(e[0].reason).toBe("exam");
  });
});

describe("payload building", () => {
  it("builds API entries with clientId and markedAt, and complete/coachNote when asked", () => {
    const q = mk([], "s1", "a", "excused", 5, "exam");
    const body = buildAttendanceBody(q, { complete: true, coachNote: "good" });
    expect(body.complete).toBe(true);
    expect(body.coachNote).toBe("good");
    expect(body.entries[0]).toMatchObject({ memberId: "a", status: "excused", reason: "exam", markedAt: at(5).toISOString() });
    expect(body.entries[0].clientId).toBe(q[0].clientId);
    expect(buildAttendanceBody(q).complete).toBeUndefined();
  });

  it("generated client ids fit the API limits (8..64 characters)", () => {
    const q = enqueue([], { sessionId: "s", memberId: "m", status: "present" });
    expect(q[0].clientId.length).toBeGreaterThanOrEqual(8);
    expect(q[0].clientId.length).toBeLessThanOrEqual(64);
  });
});

describe("replay", () => {
  const ok: SendOutcome = { kind: "ok" };

  it("sends in order and empties the queue; resending the same clientIds is what the API treats as a replay", async () => {
    let q: QueueItem[] = [];
    q = mk(q, "s1", "a", "present", 1);
    q = mk(q, "s1", "b", "absent", 2);
    q = mk(q, "s2", "c", "present", 3);
    const sent: string[][] = [];
    const res = await replayQueue(q, async (sid, items) => {
      sent.push([sid, ...items.map((i) => i.clientId)]);
      return ok;
    });
    expect(res.queue).toEqual([]);
    expect(res.synced).toHaveLength(3);
    expect(sent.map((s) => s[0])).toEqual(["s1", "s2"]);
    expect(sent[0].slice(1)).toEqual([q[0].clientId, q[1].clientId]);
    // Replaying the same items again sends the very same ids.
    const again: string[] = [];
    await replayQueue(q, async (_s, items) => (again.push(...items.map((i) => i.clientId)), ok));
    expect(again).toEqual(q.map((i) => i.clientId));
  });

  it("stops at the first network failure, keeps order and counts the attempt", async () => {
    let q: QueueItem[] = [];
    q = mk(q, "s1", "a", "present", 1);
    q = mk(q, "s2", "b", "present", 2);
    const calls: string[] = [];
    const res = await replayQueue(q, async (sid) => (calls.push(sid), { kind: "retry" }));
    expect(calls).toEqual(["s1"]);
    expect(res.offline).toBe(true);
    expect(res.queue).toHaveLength(2);
    expect(res.queue[0].attempts).toBe(1);
    expect(pending(res.queue)).toHaveLength(2);
  });

  it("parks a 409 as conflict and never retries it", async () => {
    let q: QueueItem[] = [];
    q = mk(q, "s1", "a", "present", 1);
    q = mk(q, "s1", "b", "present", 2);
    // The whole batch is refused, then each mark is tried alone: only "a" conflicts.
    const calls: string[][] = [];
    const res = await replayQueue(q, async (_s, items) => {
      calls.push(items.map((i) => i.memberId));
      if (items.some((i) => i.memberId === "a")) return { kind: "reject", code: "conflict", message: "clientId is already used" };
      return ok;
    });
    expect(calls).toEqual([["a", "b"], ["a"], ["b"]]);
    expect(res.queue).toHaveLength(1);
    expect(res.queue[0]).toMatchObject({ memberId: "a", state: "conflict", error: "clientId is already used" });
    expect(res.synced.map((i) => i.memberId)).toEqual(["b"]);
    // A second replay does not send the conflicted mark again.
    const second: string[][] = [];
    await replayQueue(res.queue, async (_s, items) => (second.push(items.map((i) => i.memberId)), ok));
    expect(second).toEqual([]);
  });

  it("stops retrying a server error after MAX_ATTEMPTS and marks it failed", async () => {
    let q = mk([], "s1", "a", "present", 1);
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      q = (await replayQueue(q, async () => ({ kind: "retry", message: "boom" }))).queue;
    }
    expect(q[0].state).toBe("failed");
    expect(buildBatches(q)).toEqual([]);
  });

  it("classifies action results", () => {
    expect(classifyResult(null).kind).toBe("retry");
    expect(classifyResult({ ok: true }).kind).toBe("ok");
    expect(classifyResult({ ok: false, code: "internal_error", message: "x" }).kind).toBe("retry");
    expect(classifyResult({ ok: false, code: "unauthorized", message: "x" }).kind).toBe("retry");
    expect(classifyResult({ ok: false, code: "conflict", message: "x" })).toEqual({ kind: "reject", code: "conflict", message: "x" });
    expect(classifyResult({ ok: false, code: "validation_failed", message: "x" }).kind).toBe("reject");
  });
});

describe("merge with the server roster", () => {
  const roster: RosterRow[] = [
    { memberId: "a", memberName: "A", source: "enrolled", attendance: "not_marked", excusedReason: null, note: null, attendanceClientId: null },
    { memberId: "b", memberName: "B", source: "enrolled", attendance: "present", excusedReason: null, note: null, attendanceClientId: "server-b-0001" },
    { memberId: "w", memberName: "W", source: "waitlisted", attendance: "not_marked", excusedReason: null, note: null, attendanceClientId: null },
  ];

  it("a waiting tap wins, waitlisted members are not tappable, completion rules hold", () => {
    expect(canComplete(mergeRoster(roster.slice(0, 1), "s1", []))).toBe("nothingMarked");
    const q = mk([], "s1", "a", "absent", 1);
    const rows = mergeRoster(roster, "s1", q);
    expect(rows[0]).toMatchObject({ attendance: "absent", sync: "queued" });
    expect(rows[2].tappable).toBe(false);
    expect(summarize(rows)).toEqual({ present: 1, absent: 1, excused: 0, notMarked: 0 });
    expect(canComplete(rows)).toBe("waiting");
    const synced = new Map([["a", q[0]]]);
    const done = mergeRoster(roster, "s1", [], synced);
    expect(done[0]).toMatchObject({ sync: "synced", justSaved: true });
    expect(canComplete(done)).toBe("ok");
  });

  it("a refused mark shows the server value and blocks completion", () => {
    const q: QueueItem[] = [{ ...mk([], "s1", "b", "absent", 1)[0], state: "conflict" }];
    const rows = mergeRoster(roster, "s1", q);
    expect(rows[1]).toMatchObject({ attendance: "present", sync: "conflict" });
    expect(canComplete(rows)).toBe("problems");
  });

  it("ignores queue items of other sessions", () => {
    const rows = mergeRoster(roster, "s1", mk([], "other", "a", "absent", 1));
    expect(rows[0].attendance).toBe("not_marked");
  });
});

describe("storage", () => {
  it("round-trips and drops malformed rows", () => {
    const q = mk([], "s1", "a", "present", 1);
    expect(parseQueue(JSON.stringify([...q, { nope: 1 }, "x"]))).toEqual(q);
    expect(parseQueue("not json")).toEqual([]);
    expect(parseQueue(null)).toEqual([]);
  });

  it("works with a working storage and survives storage that throws", () => {
    const data = new Map<string, string>();
    const good = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) } as unknown as Storage;
    const a = createQueueStore("u1", () => good);
    const q = mk([], "s1", "a", "present", 1);
    a.save(q);
    expect(createQueueStore("u1", () => good).load()).toEqual(q);
    expect(createQueueStore("u2", () => good).load()).toEqual([]); // other user, other queue
    a.save([]);
    expect(data.size).toBe(0);

    const blocked = createQueueStore("u3", () => {
      throw new Error("SecurityError");
    });
    expect(blocked.load()).toEqual([]);
    blocked.save(q);
    expect(blocked.persistent()).toBe(false);
    expect(blocked.load()).toEqual(q); // memory fallback keeps working
  });
});
