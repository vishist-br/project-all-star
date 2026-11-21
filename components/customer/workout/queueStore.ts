"use client";
import { loadQueue, saveQueue, QUEUE_KEY, type QueuedOp, type StorageLike } from "@/lib/customer/queue";

// A tiny external store for the offline queue, backed by localStorage (every access in try/catch).
// If storage is blocked (private mode), the queue still works for this page visit, in memory.

const EMPTY: QueuedOp[] = [];
let cache: QueuedOp[] | null = null;
const listeners = new Set<() => void>();

function storage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function emit() {
  for (const l of listeners) l();
}

function onStorage(e: StorageEvent) {
  if (e.key !== null && e.key !== QUEUE_KEY) return;
  cache = loadQueue(storage());
  emit();
}

export const queueStore = {
  subscribe(cb: () => void) {
    listeners.add(cb);
    if (listeners.size === 1 && typeof window !== "undefined") window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(cb);
      if (listeners.size === 0 && typeof window !== "undefined") window.removeEventListener("storage", onStorage);
    };
  },
  getSnapshot(): QueuedOp[] {
    if (cache === null) cache = loadQueue(storage());
    return cache;
  },
  getServerSnapshot(): QueuedOp[] {
    return EMPTY;
  },
  set(next: QueuedOp[]) {
    cache = next;
    saveQueue(storage(), next);
    emit();
  },
};
