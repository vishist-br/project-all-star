"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  buildLogPayload,
  buildSetsPayload,
  effectiveStatus,
  enqueue,
  isSetOp,
  itemKey,
  makeOp,
  makeSetsOp,
  opsFor,
  replayQueue,
  sameOp,
  type ItemStatus,
  type LogAction,
  type QueuedOp,
  type SendResult,
  type SetPayload,
} from "@/lib/customer/queue";
import { queueStore } from "./queueStore";

export type SyncReport = {
  synced: number;
  rejected: { code: string }[];
  stoppedBy?: "network" | "server" | "unauthorized";
};

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

/** Sends one queued tap or set save through the same-origin bridge. Network trouble, 5xx and 401 keep the op queued. */
async function sendOp(op: QueuedOp): Promise<SendResult> {
  let res: Response;
  const sets = isSetOp(op);
  try {
    res = await fetch(sets ? "/ui/workout-sets" : "/ui/workout-log", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sets ? buildSetsPayload(op) : buildLogPayload(op)),
      cache: "no-store",
    });
  } catch {
    return { kind: "retry", reason: "network" };
  }
  if (res.redirected) return { kind: "retry", reason: "unauthorized" };
  if (res.ok) {
    try {
      const body = (await res.json()) as { status?: ItemStatus };
      return { kind: "ok", status: body.status, data: body };
    } catch {
      return { kind: "ok" };
    }
  }
  if (res.status === 401) return { kind: "retry", reason: "unauthorized" };
  if (res.status >= 500 || res.status === 429 || res.status === 408) return { kind: "retry", reason: "server" };
  let code = "other";
  let message = "";
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    code = body.error?.code ?? code;
    message = body.error?.message ?? "";
  } catch {
    // keep defaults
  }
  return { kind: "reject", code, message };
}

/**
 * Optimistic start/stop/complete/skip with an offline queue. Every tap is saved on the phone first
 * (localStorage), shown immediately, then replayed to the server in order. A tap the server refuses
 * for good is dropped, which rolls the item back to the server's status. `serverData` is any value
 * whose identity changes when the page's server data is refreshed.
 */
export function useWorkoutLogger(serverData: unknown, options?: { onSynced?: (op: QueuedOp, data: unknown) => void; onRejected?: (op: QueuedOp, code: string) => void; refreshOnSync?: boolean }) {
  const router = useRouter();
  const queue = useSyncExternalStore(queueStore.subscribe, queueStore.getSnapshot, queueStore.getServerSnapshot);
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const [syncing, setSyncing] = useState(false);
  const [report, setReport] = useState<SyncReport | null>(null);
  const [confirmed, setConfirmed] = useState<{ forData: unknown; map: Record<string, ItemStatus> }>({ forData: serverData, map: {} });
  const flushing = useRef(false);
  const dataRef = useRef(serverData);
  const optionsRef = useRef(options);
  useEffect(() => {
    dataRef.current = serverData;
    optionsRef.current = options;
  });

  const flush = useCallback(async () => {
    if (flushing.current) return;
    if (queueStore.getSnapshot().length === 0) return;
    if (!navigator.onLine) return;
    flushing.current = true;
    setSyncing(true);
    let synced = 0;
    const rejected: { code: string }[] = [];
    let stoppedBy: SyncReport["stoppedBy"];
    try {
      // Loop so taps made while a replay was running are sent in the same pass.
      for (let guard = 0; guard < 20 && queueStore.getSnapshot().length > 0; guard++) {
        const res = await replayQueue(queueStore.getSnapshot(), sendOp, (op, result) => {
          queueStore.set(queueStore.getSnapshot().filter((q) => !sameOp(q, op)));
          const key = itemKey(op.assignmentId, op.planItemId, op.scheduledFor);
          if (result.kind === "ok") {
            synced += 1;
            optionsRef.current?.onSynced?.(op, result.data);
            const st = result.status;
            if (st) {
              setConfirmed((c) => ({
                forData: dataRef.current,
                map: { ...(c.forData === dataRef.current ? c.map : {}), [key]: st },
              }));
            }
          } else if (result.kind === "reject") {
            rejected.push({ code: result.code });
            optionsRef.current?.onRejected?.(op, result.code);
          }
        });
        if (res.interrupted) {
          stoppedBy = res.reason;
          break;
        }
      }
    } finally {
      flushing.current = false;
      setSyncing(false);
    }
    if (synced > 0 || rejected.length > 0 || stoppedBy) setReport({ synced, rejected, stoppedBy });
    // Refresh the server-rendered status (also after a refusal, so the item rolls back to the truth).
    if ((synced > 0 || rejected.length > 0) && optionsRef.current?.refreshOnSync !== false) router.refresh();
  }, [router]);

  // Replay on load, when the connection returns, and now and then while taps are waiting.
  useEffect(() => {
    const first = window.setTimeout(() => void flush(), 0);
    const onOnline = () => void flush();
    window.addEventListener("online", onOnline);
    const timer = window.setInterval(() => void flush(), 20_000);
    return () => {
      window.clearTimeout(first);
      window.removeEventListener("online", onOnline);
      window.clearInterval(timer);
    };
  }, [flush]);

  const perform = useCallback(
    (input: { memberId: string; assignmentId: string; planItemId: string; scheduledFor: string; action: LogAction }) => {
      queueStore.set(enqueue(queueStore.getSnapshot(), makeOp(input)));
      setReport(null);
      void flush();
    },
    [flush],
  );

  /** Saves ticked sets of one exercise (per-set recordWorkoutSets). Saved on the phone first, then replayed. */
  const performSets = useCallback(
    (input: { memberId: string; assignmentId: string; planItemId: string; scheduledFor: string; sets: SetPayload[]; complete?: boolean }) => {
      queueStore.set(enqueue(queueStore.getSnapshot(), makeSetsOp(input)));
      setReport(null);
      void flush();
    },
    [flush],
  );

  const known = confirmed.forData === serverData ? confirmed.map : {};
  const statusOf = (item: { assignmentId: string; planItemId: string; date: string; status: ItemStatus }): { status: ItemStatus; queued: boolean } => {
    const key = itemKey(item.assignmentId, item.planItemId, item.date);
    const ops = opsFor(queue, key);
    return { status: effectiveStatus(known[key] ?? item.status, ops), queued: ops.length > 0 };
  };

  return { queue, online, syncing, report, perform, performSets, statusOf, flush, dismissReport: () => setReport(null) };
}
