"use client";
import { Button } from "@/components/ui/Button";
import { useI18n } from "@/lib/i18n/client";
import { useAttendanceQueue } from "./useAttendanceQueue";
import s from "./sessions.module.css";

/** On Today: syncs marks left on this device (for example after a bad connection) and shows how many wait. */
export function QueueStatus({ userId }: { userId: string }) {
  const { t } = useI18n();
  const q = useAttendanceQueue(userId);
  if (!q.ready || (q.waiting === 0 && q.problemItems.length === 0)) return null;
  return (
    <div className={s.stack} style={{ marginBottom: "var(--s4)" }}>
      {q.waiting > 0 && (
        <div className={`${s.syncBar} ${s.syncWaiting}`} role="status">
          <span>{q.online ? t("sess.sync.waiting", { n: q.waiting }) : t("sess.sync.waitingOffline", { n: q.waiting })}</span>
          {q.online && <Button variant="secondary" onClick={() => void q.flush()} loading={q.syncing}>{t("sess.sync.now")}</Button>}
        </div>
      )}
      {q.problemItems.length > 0 && (
        <div className={s.syncBox} role="alert">
          <p><strong>{t("sess.sync.problems", { n: q.problemItems.length })}</strong></p>
          <div><Button variant="secondary" onClick={() => q.discardProblems()}>{t("sess.sync.discard")}</Button></div>
        </div>
      )}
    </div>
  );
}
