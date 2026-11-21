"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { recordAttendanceAction } from "@/app/[role]/_actions/sessions";
import { buildAttendanceBody, classifyResult, enqueue, pending, problems, replayQueue, type NewMark, type QueueItem, type SendOutcome } from "@/lib/offline/queue";
import { createQueueStore, type QueueStore } from "@/lib/offline/storage";

const RETRY_MS = 15_000;

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

/**
 * The browser side of offline roll call. Taps are queued in localStorage (memory if storage is
 * blocked) and replayed in order whenever the connection is back. Replay is safe to repeat: every
 * mark keeps its clientId, and the API treats the same clientId with the same values as a replay.
 */
export function useAttendanceQueue(userId: string) {
  const online = useOnline();
  const store = useRef<QueueStore | null>(null);
  const queueRef = useRef<QueueItem[]>([]);
  const flushing = useRef(false);
  const again = useRef(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [synced, setSynced] = useState<Map<string, QueueItem>>(new Map());
  const [syncing, setSyncing] = useState(false);
  const [persistent, setPersistent] = useState(true);
  const [ready, setReady] = useState(false);

  const commit = useCallback((next: QueueItem[]) => {
    queueRef.current = next;
    setQueue(next);
    store.current?.save(next);
    setPersistent(store.current?.persistent() ?? true);
  }, []);

  const flush = useCallback(async () => {
    if (flushing.current) {
      again.current = true;
      return;
    }
    flushing.current = true;
    setSyncing(true);
    try {
      do {
        again.current = false;
        if (pending(queueRef.current).length === 0 || !navigator.onLine) break;
        const send = async (sessionId: string, items: QueueItem[]): Promise<SendOutcome> => {
          try {
            return classifyResult(await recordAttendanceAction(sessionId, buildAttendanceBody(items)));
          } catch {
            return classifyResult(null); // no network: keep the marks and try again later
          }
        };
        const result = await replayQueue(queueRef.current, send);
        // Apply the outcome to the live queue: taps made while sending are kept untouched.
        const done = new Set(result.synced.map((s) => s.clientId));
        const byId = new Map(result.queue.map((q) => [q.clientId, q]));
        commit(queueRef.current.filter((q) => !done.has(q.clientId)).map((q) => byId.get(q.clientId) ?? q));
        if (result.synced.length) {
          setSynced((cur) => {
            const next = new Map(cur);
            for (const s of result.synced) {
              const live = queueRef.current.find((q) => q.sessionId === s.sessionId && q.memberId === s.memberId);
              if (!live) next.set(`${s.sessionId}|${s.memberId}`, s);
            }
            return next;
          });
        }
        if (result.offline) break;
      } while (again.current);
    } finally {
      flushing.current = false;
      setSyncing(false);
    }
  }, [commit]);

  // Load what is on the device after hydration, then try to send it.
  useEffect(() => {
    store.current = createQueueStore(userId);
    const loaded = store.current.load();
    queueRef.current = loaded;
    setQueue(loaded);
    setPersistent(store.current.persistent());
    setReady(true);
    if (pending(loaded).length) void flush();
    const onStorage = () => {
      const fresh = store.current?.load() ?? [];
      queueRef.current = fresh;
      setQueue(fresh);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [userId, flush]);

  useEffect(() => {
    if (online && ready && pending(queueRef.current).length) void flush();
  }, [online, ready, flush]);

  // A flaky connection can say "online" and still fail; keep trying gently while marks wait.
  const waiting = pending(queue).length;
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => void flush(), RETRY_MS);
    return () => clearInterval(id);
  }, [waiting, flush]);

  const mark = useCallback(
    (m: NewMark) => {
      commit(enqueue(queueRef.current, m));
      setSynced((cur) => {
        if (!cur.has(`${m.sessionId}|${m.memberId}`)) return cur;
        const next = new Map(cur);
        next.delete(`${m.sessionId}|${m.memberId}`);
        return next;
      });
      if (navigator.onLine) void Promise.resolve().then(flush);
    },
    [commit, flush],
  );

  /** Drops refused marks (conflict or failed); the server value shows again. */
  const discardProblems = useCallback(
    (sessionId?: string) => {
      commit(queueRef.current.filter((q) => q.state === "queued" || (sessionId !== undefined && q.sessionId !== sessionId)));
    },
    [commit],
  );

  const syncedFor = useMemo(() => {
    const out = new Map<string, Map<string, QueueItem>>();
    for (const [k, v] of synced) {
      const m = out.get(v.sessionId) ?? new Map<string, QueueItem>();
      m.set(k.split("|")[1]!, v);
      out.set(v.sessionId, m);
    }
    return out;
  }, [synced]);

  return {
    queue,
    waiting,
    problemItems: problems(queue),
    syncedFor,
    syncing,
    online,
    persistent,
    ready,
    mark,
    flush,
    discardProblems,
    /** Latest queue, read without waiting for a render. */
    latest: () => queueRef.current,
  };
}
