"use client";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { Tone } from "./Badge";

type ToastItem = { id: number; text: string; tone: Tone };
type Ctx = { toast: (text: string, tone?: Tone) => void };
const ToastContext = createContext<Ctx | null>(null);

/** Mount once (AppShell does). Messages go to an aria-live="polite" region and clear themselves after 4 seconds. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const toast = useCallback((text: string, tone: Tone = "ok") => {
    const id = next.current++;
    setItems((cur) => [...cur, { id, text, tone }]);
    setTimeout(() => setItems((cur) => cur.filter((i) => i.id !== id)), 4000);
  }, []);
  const value = useMemo(() => ({ toast }), [toast]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite" aria-atomic="false">
        {items.map((i) => (
          <p key={i.id} className={`toast toast-${i.tone}`}>{i.text}</p>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** const { toast } = useToast(); toast(t("saved")) for success feedback, toast(msg, "danger") for a problem. */
export function useToast(): Ctx {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
