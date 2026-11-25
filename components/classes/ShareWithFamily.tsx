"use client";
import { useState, useSyncExternalStore } from "react";
import { shareClassSummaryAction } from "@/app/[role]/_actions/send-classes";
import { Button } from "@/components/ui/Button";
import { useI18n } from "@/lib/i18n/client";
import s from "./classes.module.css";

function subscribe(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

/**
 * "Share with family": makes a 30-day link for this child's summary (first name only on the page) and
 * copies it. If the browser blocks the clipboard, the link is shown so it can be copied by hand.
 */
export function ShareWithFamily({ sessionId, memberId }: { sessionId: string; memberId: string }) {
  const { t } = useI18n();
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  const [state, setState] = useState<"idle" | "working" | "copied" | "manual" | "error">("idle");
  const [url, setUrl] = useState("");

  async function share() {
    if (!online) {
      setState("error");
      return;
    }
    setState("working");
    try {
      const res = await shareClassSummaryAction(sessionId, memberId);
      if (!res.ok) {
        setState("error");
        return;
      }
      setUrl(res.data.url);
      try {
        await navigator.clipboard.writeText(res.data.url);
        setState("copied");
      } catch {
        setState("manual");
      }
    } catch {
      setState("error");
    }
  }

  return (
    <div className={s.shareBox}>
      <div className={s.actions}>
        <Button variant="secondary" onClick={() => void share()} loading={state === "working"} disabled={!online}>
          {state === "working" ? t("csm.share.working") : t("csm.share")}
        </Button>
      </div>
      <p className={s.hint} role="status" aria-live="polite">
        {state === "copied" ? t("csm.share.done") : !online ? t("csm.share.offline") : ""}
      </p>
      {state === "manual" && (
        <div className="field">
          <label className="field-label" htmlFor={`share-${sessionId}`}>{t("csm.share.manual")}</label>
          <input id={`share-${sessionId}`} className="input" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
        </div>
      )}
      {state === "error" && <p className={s.errorBox} role="alert">{t("csm.share.err")}</p>}
    </div>
  );
}
