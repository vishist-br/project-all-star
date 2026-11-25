import { describe, expect, it } from "vitest";
import {
  buildSetsPayload,
  effectiveStatus,
  enqueue,
  isSetOp,
  loadQueue,
  makeClientId,
  makeOp,
  makeSetClientId,
  makeSetsOp,
  replayQueue,
  saveQueue,
  sameOp,
  type QueuedOp,
  type SendResult,
} from "../lib/customer/queue";
import { ADD_SECONDS, addRest, isRestOver, remainingSeconds, restPercent, startRest } from "../lib/workouts/live/rest";

const base = { memberId: "m1", assignmentId: "a1", planItemId: "i1", scheduledFor: "2026-11-25" };
const set = (n: number) => ({ clientId: makeSetClientId("m1", "a1", "i1", "2026-11-25", n), setNumber: n, weightKg: 40, reps: 8 });

describe("per-set queue ops", () => {
  it("makes stable ids: the log id matches the item-level one, each set has its own", () => {
    const op = makeSetsOp({ ...base, sets: [set(1)] });
    expect(op.clientId).toBe(makeClientId("m1", "a1", "i1", "2026-11-25"));
    expect(set(1).clientId).toBe(set(1).clientId);
    expect(set(1).clientId).not.toBe(set(2).clientId);
    expect(set(1).clientId).toMatch(/^ws-/);
    expect(set(1).clientId.length).toBe(31);
  });
  it("builds the recordWorkoutSets body", () => {
    const body = buildSetsPayload(makeSetsOp({ ...base, sets: [set(1)], complete: true }));
    expect(body).toEqual({ clientId: makeClientId("m1", "a1", "i1", "2026-11-25"), assignmentId: "a1", planItemId: "i1", memberId: "m1", scheduledFor: "2026-11-25", sets: [set(1)], complete: true });
  });
  it("keeps the order of sets and ignores saving the very same sets twice", () => {
    let q: QueuedOp[] = [];
    q = enqueue(q, makeSetsOp({ ...base, sets: [set(1)] }, new Date(1)));
    q = enqueue(q, makeSetsOp({ ...base, sets: [set(1)] }, new Date(2))); // double tap
    q = enqueue(q, makeSetsOp({ ...base, sets: [set(2)] }, new Date(3)));
    q = enqueue(q, makeSetsOp({ ...base, sets: [{ ...set(2), reps: 9 }] }, new Date(4))); // an edit is a new save
    expect(q.map((o) => (isSetOp(o) ? o.sets[0]!.setNumber + ":" + o.sets[0]!.reps : "item"))).toEqual(["1:8", "2:8", "2:9"]);
  });
  it("lives alongside item-level taps; a set save counts as started, a complete save as completed", () => {
    let q: QueuedOp[] = [makeOp({ ...base, action: "start" })];
    q = enqueue(q, makeSetsOp({ ...base, sets: [set(1)] }));
    expect(q).toHaveLength(2);
    expect(effectiveStatus("pending", [makeSetsOp({ ...base, sets: [set(1)] })])).toBe("started");
    expect(effectiveStatus("started", [makeSetsOp({ ...base, sets: [set(1)], complete: true })])).toBe("completed");
    expect(effectiveStatus("completed", [makeSetsOp({ ...base, sets: [set(1)] })])).toBe("completed");
  });
  it("tells two set ops apart by id, time and sets", () => {
    const a = makeSetsOp({ ...base, sets: [set(1)] }, new Date(1));
    expect(sameOp(a, { ...a })).toBe(true);
    expect(sameOp(a, makeSetsOp({ ...base, sets: [set(2)] }, new Date(1)))).toBe(false);
    expect(sameOp(a, makeOp({ ...base, action: "start" }, new Date(1)))).toBe(false);
  });
  it("replays in order, stops at a network error and keeps the rest; replaying twice sends the same set ids", async () => {
    const q = [1, 2, 3].map((n) => makeSetsOp({ ...base, sets: [set(n)] }, new Date(n)));
    const sent: number[] = [];
    let calls = 0;
    const send = async (op: QueuedOp): Promise<SendResult> => {
      if (!isSetOp(op)) return { kind: "ok" };
      if (++calls === 2) return { kind: "retry", reason: "network" };
      sent.push(op.sets[0]!.setNumber);
      return { kind: "ok", data: { newBests: [] } };
    };
    const first = await replayQueue(q, send);
    expect(first.interrupted).toBe(true);
    expect(first.synced).toHaveLength(1);
    expect(first.remaining.map((o) => (isSetOp(o) ? o.sets[0]!.setNumber : 0))).toEqual([2, 3]);
    const second = await replayQueue(first.remaining, send);
    expect(second.remaining).toEqual([]);
    expect(sent).toEqual([1, 2, 3]);
    expect(second.synced[0]!.data).toEqual({ newBests: [] });
  });
  it("saves and reloads set ops, and drops entries that are not valid", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    const op = makeSetsOp({ ...base, sets: [set(1)] });
    saveQueue(storage, [op, makeOp({ ...base, action: "complete" })]);
    expect(loadQueue(storage)).toHaveLength(2);
    store.set("workoutQueue.v1", JSON.stringify([{ ...op, sets: [] }, { ...op, action: "nope" }, op]));
    expect(loadQueue(storage)).toHaveLength(1);
  });
});

describe("rest timer", () => {
  it("counts down from an end time, rounds up, and is over at zero", () => {
    const r = startRest(1, 1000, 60);
    expect(remainingSeconds(r, 1000)).toBe(60);
    expect(remainingSeconds(r, 1000 + 59_500)).toBe(1);
    expect(isRestOver(r, 1000 + 60_000)).toBe(true);
    expect(remainingSeconds(r, 1000 + 90_000)).toBe(0);
  });
  it("adds 15 seconds, also after it ended", () => {
    const r = startRest(1, 0, 30);
    const more = addRest(r, 10_000);
    expect(remainingSeconds(more, 10_000)).toBe(20 + ADD_SECONDS);
    expect(more.totalSeconds).toBe(30 + ADD_SECONDS);
    const again = addRest(r, 99_000);
    expect(remainingSeconds(again, 99_000)).toBe(ADD_SECONDS);
  });
  it("reports percent done and caps long rests", () => {
    const r = startRest(1, 0, 60);
    expect(restPercent(r, 0)).toBe(0);
    expect(restPercent(r, 30_000)).toBe(50);
    expect(restPercent(r, 60_000)).toBe(100);
    expect(startRest(1, 0, 99_999).totalSeconds).toBe(900);
  });
});
