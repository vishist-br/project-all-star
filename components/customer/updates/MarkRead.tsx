"use client";
import { useEffect, useState } from "react";
import { markUpdatesReadAction } from "@/app/[role]/_actions/workouts";
import { useI18n } from "@/lib/i18n/client";

/**
 * Marks the feed as read once it has been shown: `upTo` is the newest createdAt on screen, so an
 * update that arrives while the page is open stays unread. The list keeps its "New" markers for
 * this visit; the next visit (and the Home badge) show everything as read.
 */
export function MarkRead({ memberId, upTo }: { memberId: string; upTo: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<"working" | "done" | "failed">("working");
  useEffect(() => {
    let cancelled = false;
    markUpdatesReadAction(memberId, upTo)
      .then((r) => !cancelled && setState(r.ok ? "done" : "failed"))
      .catch(() => !cancelled && setState("failed"));
    return () => {
      cancelled = true;
    };
  }, [memberId, upTo]);
  return (
    <p className="small muted" role="status" data-testid="mark-read" data-state={state}>
      {state === "done" ? t("upd.markedRead") : state === "failed" ? t("upd.markFailed") : ""}
    </p>
  );
}
