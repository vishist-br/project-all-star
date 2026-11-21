import { describe, expect, it } from "vitest";
import {
  QUEUE_KEY,
  availableActions,
  buildLogPayload,
  effectiveStatus,
  enqueue,
  itemKey,
  loadQueue,
  makeClientId,
  makeOp,
  nextItemStatus,
  opsFor,
  replayQueue,
  saveQueue,
  type LogAction,
  type QueuedOp,
  type SendResult,
  type StorageLike,
} from "../lib/customer/queue";

const base = { memberId: "m1", assignmentId: "a1", planItemId: "i1", scheduledFor: "2026-11-21" };
const at = (min: number) => new Date(Date.UTC(2026, 10, 21, 4, min));
const op = (action: LogAction, over: Partial<typeof base> = {}, min = 0) => makeOp({ ...base, ...over, action }, at(min));

function memoryStorage(initial?: string): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>(initial ? [[QUEUE_KEY, initial]] : []);
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe("clientId", () => {
  it("is stable for an item-day and within the API's 8..64 length", () => {
    const a = makeClientId("m1", "a1", "i1", "2026-11-21");
    expect(a).toBe(makeClientId("m1", "a1", "i1", "2026-11-21"));
    expect(a.length).toBeGreaterThanOrEqual(8);
    expect(a.length).toBeLessThanOrEqual(64);
    expect(a).toMatch(/^wl-[0-9a-f]+$/);
  });
  it("differs per item, per day, per assignment and per member", () => {
    const ids = new Set([
      makeClientId("m1", "a1", "i1", "2026-11-21"),
      makeClientId("m1", "a1", "i2", "2026-11-21"),
      makeClientId("m1", "a1", "i1", "2026-11-22"),
      makeClientId("m1", "a2", "i1", "2026-11-21"),
      makeClientId("m2", "a1", "i1", "2026-11-21"),
    ]);
    expect(ids.size).toBe(5);
  });
  it("is shared by every action on the same item-day", () => {
    expect(op("start").clientId).toBe(op("complete", {}, 5).clientId);
  });
});

describe("payload", () => {
  it("builds the PUT /workout-logs body with the device time as occurredAt", () => {
    const o = op("complete", {}, 7);
    expect(buildLogPayload(o)).toEqual({
      clientId: o.clientId,
      assignmentId: "a1",
      planItemId: "i1",
      memberId: "m1",
      scheduledFor: "2026-11-21",
      action: "complete",
      occurredAt: "2026-11-21T04:07:00.000Z",
    });
  });
});

describe("state machine", () => {
  it("mirrors the API transitions", () => {
    expect(nextItemStatus("pending", "start")).toBe("started");
    expect(nextItemStatus("pending", "stop")).toBeNull();
    expect(nextItemStatus("pending", "skip")).toBe("skipped");
    expect(nextItemStatus("started", "stop")).toBe("stopped");
    expect(nextItemStatus("stopped", "start")).toBe("started");
    expect(nextItemStatus("started", "complete")).toBe("completed");
    expect(nextItemStatus("started", "skip")).toBeNull();
    expect(nextItemStatus("completed", "start")).toBeNull();
    expect(nextItemStatus("completed", "complete")).toBe("completed");
    expect(nextItemStatus("skipped", "complete")).toBeNull();
  });
  it("offers the right buttons per status", () => {
    expect(availableActions("pending")).toEqual(["start", "skip"]);
    expect(availableActions("started")).toEqual(["stop", "complete"]);
    expect(availableActions("stopped")).toEqual(["start", "complete"]);
    expect(availableActions("completed")).toEqual([]);
    expect(availableActions("skipped")).toEqual([]);
  });
  it("shows the queued taps applied in order on top of the server status", () => {
    const q = [op("start", {}, 0), op("stop", {}, 1), op("complete", {}, 2)];
    expect(effectiveStatus("pending", q)).toBe("completed");
    expect(effectiveStatus("pending", [op("stop")])).toBe("pending");
    expect(opsFor([...q, op("start", { planItemId: "i2" })], itemKey("a1", "i1", "2026-11-21"))).toHaveLength(3);
  });
});

describe("enqueue", () => {
  it("keeps the order of the taps and ignores a double tap", () => {
    let q: QueuedOp[] = [];
    q = enqueue(q, op("start", {}, 0));
    q = enqueue(q, op("start", {}, 1)); // double tap
    q = enqueue(q, op("complete", {}, 2));
    q = enqueue(q, op("start", { planItemId: "i2" }, 3));
    expect(q.map((x) => `${x.planItemId}:${x.action}`)).toEqual(["i1:start", "i1:complete", "i2:start"]);
  });
  it("is bounded so a long offline spell cannot fill the storage", () => {
    let q: QueuedOp[] = [];
    for (let i = 0; i < 260; i++) q = enqueue(q, op(i % 2 ? "start" : "stop", { planItemId: `i${i}` }, i % 50));
    expect(q.length).toBeLessThanOrEqual(200);
    expect(q[q.length - 1]!.planItemId).toBe("i259");
  });
});

describe("replay", () => {
  const ok: SendResult = { kind: "ok" };

  it("sends in order and empties the queue", async () => {
    const q = [op("start", {}, 0), op("complete", {}, 1), op("start", { planItemId: "i2" }, 2)];
    const sent: string[] = [];
    const steps: string[] = [];
    const res = await replayQueue(
      q,
      async (o) => {
        sent.push(`${o.planItemId}:${o.action}`);
        return ok;
      },
      (o) => steps.push(o.action),
    );
    expect(sent).toEqual(["i1:start", "i1:complete", "i2:start"]);
    expect(steps).toEqual(["start", "complete", "start"]);
    expect(res.remaining).toEqual([]);
    expect(res.synced).toHaveLength(3);
    expect(res.interrupted).toBe(false);
  });

  it("stops at the first network failure and keeps that op and everything after it, in order", async () => {
    const q = [op("start", {}, 0), op("stop", {}, 1), op("complete", {}, 2)];
    let n = 0;
    const res = await replayQueue(q, async () => (++n === 1 ? ok : { kind: "retry", reason: "network" }));
    expect(n).toBe(2); // did not skip ahead to the third
    expect(res.remaining.map((o) => o.action)).toEqual(["stop", "complete"]);
    expect(res.synced).toHaveLength(1);
    expect(res.interrupted).toBe(true);
    expect(res.reason).toBe("network");
  });

  it("treats a thrown fetch as a retry", async () => {
    const res = await replayQueue([op("start")], async () => {
      throw new Error("offline");
    });
    expect(res.remaining).toHaveLength(1);
    expect(res.interrupted).toBe(true);
  });

  it("drops an op the server refuses for good and carries on with the rest", async () => {
    const q = [op("complete", {}, 0), op("start", { planItemId: "i2" }, 1)];
    const res = await replayQueue(q, async (o) =>
      o.planItemId === "i1" ? { kind: "reject", code: "conflict", message: "already skipped" } : ok,
    );
    expect(res.rejected).toEqual([{ op: q[0], code: "conflict", message: "already skipped" }]);
    expect(res.synced.map((s) => s.op.planItemId)).toEqual(["i2"]);
    expect(res.remaining).toEqual([]);
  });

  it("reports an expired sign-in so the screen can say so", async () => {
    const res = await replayQueue([op("start")], async () => ({ kind: "retry", reason: "unauthorized" }));
    expect(res.reason).toBe("unauthorized");
    expect(res.remaining).toHaveLength(1);
  });
});

describe("persistence", () => {
  it("round-trips the queue through storage and clears the key when empty", () => {
    const st = memoryStorage();
    const q = [op("start", {}, 0), op("complete", {}, 1)];
    expect(saveQueue(st, q)).toBe(true);
    expect(loadQueue(st)).toEqual(q);
    expect(saveQueue(st, [])).toBe(true);
    expect(st.data.has(QUEUE_KEY)).toBe(false);
  });
  it("survives broken, hostile or blocked storage", () => {
    expect(loadQueue(memoryStorage("not json"))).toEqual([]);
    expect(loadQueue(memoryStorage('{"a":1}'))).toEqual([]);
    expect(loadQueue(memoryStorage(JSON.stringify([op("start"), { clientId: 1 }, { ...op("start"), action: "delete" }])))).toHaveLength(1);
    expect(loadQueue(null)).toEqual([]);
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadQueue(throwing)).toEqual([]);
    expect(saveQueue(throwing, [op("start")])).toBe(false);
    expect(saveQueue(null, [op("start")])).toBe(false);
  });
});
