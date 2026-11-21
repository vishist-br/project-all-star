"use client";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n";
import type { SyncReport } from "./useWorkoutLogger";
import s from "./Workout.module.css";

const REASON: Record<string, MessageKey> = {
  conflict: "cu.sync.reason.conflict",
  forbidden: "cu.sync.reason.forbidden",
  not_found: "cu.sync.reason.forbidden",
  validation_failed: "cu.sync.reason.invalid",
};

/** One live region that says what happened to the taps: waiting, syncing, synced or not saved. */
export function SyncStatus({ queued, online, syncing, report }: { queued: number; online: boolean; syncing: boolean; report: SyncReport | null }) {
  const { t } = useI18n();
  let text: string | null = null;
  let tone: "info" | "ok" | "warn" = "info";
  if (queued > 0) {
    if (!online) text = t("cu.sync.offline", { n: queued });
    else if (syncing) text = t("cu.sync.syncing");
    else if (report?.stoppedBy === "unauthorized") {
      text = t("cu.sync.reason.signin");
      tone = "warn";
    } else text = t("cu.sync.waiting", { n: queued });
  } else if (report) {
    if (report.rejected.length > 0) {
      const reason = t(REASON[report.rejected[0]!.code] ?? "cu.sync.reason.other");
      text = t("cu.sync.rejected", { n: report.rejected.length, reason });
      tone = "warn";
    } else if (report.synced > 0) {
      text = t("cu.sync.done");
      tone = "ok";
    }
  }
  return (
    <div role="status" aria-live="polite" data-testid="sync-status">
      {text && <p className={`${s.sync} ${s[`sync_${tone}`]}`}>{text}</p>}
    </div>
  );
}
