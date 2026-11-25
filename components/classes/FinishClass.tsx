"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { finishClassAction } from "@/app/[role]/_actions/send-classes";
import { Button } from "@/components/ui/Button";
import { FormField } from "@/components/ui/Form";
import { Sheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { finishAudience } from "@/lib/classes/view";
import { useI18n } from "@/lib/i18n/client";
import {
  addIntent,
  bumpAttempt,
  intentBody,
  loadIntents,
  makeIntent,
  MAX_FINISH_ATTEMPTS,
  readyIntents,
  removeIntent,
  saveIntents,
  type FinishIntent,
} from "@/lib/offline/finish";
import { classifyResult } from "@/lib/offline/queue";
import { canComplete, markedRows, type RowView } from "@/lib/offline/rollcall";
import type { QueueItem } from "@/lib/offline/queue";
import s from "./classes.module.css";

const RETRY_MS = 15_000;

type Queue = { online: boolean; waiting: number; latest: () => QueueItem[] };

/**
 * "Finish class and send". A confirm sheet explains who gets what, takes an optional coach note and
 * home practice, then finishes the roll call and publishes the class summary in one step. With no
 * connection the finish is saved on this device and sent as soon as the marks have synced.
 */
export function FinishClass({
  sessionId,
  userId,
  rows,
  q,
  note,
  workoutTitle,
  completed,
}: {
  sessionId: string;
  userId: string;
  rows: RowView[];
  q: Queue;
  note: string;
  workoutTitle: string | null;
  completed: boolean;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [coachNote, setCoachNote] = useState(note);
  const [practice, setPractice] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [intents, setIntents] = useState<FinishIntent[]>([]);
  const [sending, setSending] = useState(false);
  const ref = useRef<FinishIntent[]>([]);
  const running = useRef(false);
  const qRef = useRef(q);
  useEffect(() => {
    qRef.current = q;
  });

  const commit = useCallback(
    (next: FinishIntent[]) => {
      ref.current = next;
      setIntents(next);
      saveIntents(userId, next);
    },
    [userId],
  );

  const run = useCallback(async () => {
    if (running.current || !navigator.onLine) return;
    running.current = true;
    setSending(true);
    try {
      for (const i of readyIntents(ref.current, qRef.current.latest())) {
        let res: Awaited<ReturnType<typeof finishClassAction>>;
        try {
          res = await finishClassAction(i.sessionId, intentBody(i));
        } catch {
          break; // no network: keep it, try again later
        }
        if (res.ok) {
          commit(removeIntent(ref.current, i.sessionId));
          toast(res.data.published ? t("cls.finish.done") : t("cls.finish.doneNoSummary"));
          if (i.sessionId === sessionId) router.refresh();
          continue;
        }
        const verdict = classifyResult(res);
        if (verdict.kind === "retry") commit(bumpAttempt(ref.current, i.sessionId));
        else {
          commit(ref.current.map((x) => (x.sessionId === i.sessionId ? { ...x, attempts: MAX_FINISH_ATTEMPTS } : x)));
          if (i.sessionId === sessionId) setProblem(t("cls.finish.err"));
        }
        break;
      }
    } finally {
      running.current = false;
      setSending(false);
    }
  }, [commit, router, sessionId, t, toast]);

  useEffect(() => {
    const loaded = loadIntents(userId);
    ref.current = loaded;
    void Promise.resolve().then(() => setIntents(loaded));
  }, [userId]);

  const mine = intents.find((i) => i.sessionId === sessionId) ?? null;
  const stuck = mine !== null && mine.attempts >= MAX_FINISH_ATTEMPTS;

  // Send when the connection is back and this device's marks have reached the server.
  useEffect(() => {
    if (intents.length > 0 && q.online) void run();
  }, [intents, q.online, q.waiting, run]);
  useEffect(() => {
    if (intents.length === 0) return;
    const id = setInterval(() => void run(), RETRY_MS);
    return () => clearInterval(id);
  }, [intents.length, run]);

  const audience = finishAudience(rows);

  function begin() {
    setProblem(null);
    const check = canComplete(rows);
    if (check === "nothingMarked") return setProblem(t("cls.finish.nothingMarked"));
    if (check === "problems") return setProblem(t("cls.finish.problems"));
    // "waiting" is fine here: queued marks are sent with the finish, in order.
    setCoachNote(note);
    setOpen(true);
  }

  function confirm() {
    const marked = markedRows(rows);
    if (marked.length === 0) {
      setProblem(t("cls.finish.nothingMarked"));
      setOpen(false);
      return;
    }
    const intent = makeIntent({
      sessionId,
      entries: marked.map((r) => ({ memberId: r.memberId, status: r.attendance as "present" | "absent" | "excused", reason: r.excusedReason, note: r.note, clientId: r.attendanceClientId! })),
      coachNote,
      homePractice: practice,
    });
    commit(addIntent(ref.current, intent));
    setOpen(false);
    setPractice("");
    if (navigator.onLine) void run();
  }

  if (completed) return null;
  const pending = mine !== null && !stuck;
  return (
    <div className={s.stack}>
      <p className={s.infoCard} data-testid="finish-info">{t("cls.info")}</p>
      {pending && <p className={s.queued} role="status" data-testid="finish-queued">{q.online || sending ? t("cls.finish.syncing") : t("cls.finish.queuedBanner")}</p>}
      {problem && <p className={s.errorBox} role="alert">{problem}</p>}
      {stuck && <p className={s.errorBox} role="alert">{t("cls.finish.err")}</p>}
      <div>
        <Button size="lg" onClick={begin} disabled={pending} loading={sending && pending}>{t("cls.finish")}</Button>
      </div>

      <Sheet open={open} title={t("cls.finish.title")} closeLabel={t("cls.finish.close")} onClose={() => setOpen(false)}>
        <div className={s.sheetBody}>
          <ul className={s.audience}>
            <li><span className={`${s.dot} ${s.dotOk}`} aria-hidden="true" />{t("cls.finish.present", { n: audience.present })}</li>
            <li><span className={`${s.dot} ${s.dotWarn}`} aria-hidden="true" />{t("cls.finish.absent", { n: audience.absent })}</li>
            <li><span className={`${s.dot} ${s.dotInfo}`} aria-hidden="true" />{t("cls.finish.told", { n: audience.told })}</li>
          </ul>
          <p className="muted small">{workoutTitle ? t("cls.finish.workout", { plan: workoutTitle }) : t("cls.finish.noWorkout")}</p>
          <FormField label={t("cls.finish.note")} hint={t("cls.finish.noteHint")}>
            {(p) => <textarea {...p} className={`input ${s.textarea}`} maxLength={1000} value={coachNote} onChange={(e) => setCoachNote(e.target.value)} />}
          </FormField>
          <FormField label={t("cls.finish.practice")} hint={t("cls.finish.practiceHint")}>
            {(p) => <textarea {...p} className={`input ${s.textarea}`} maxLength={1000} value={practice} onChange={(e) => setPractice(e.target.value)} />}
          </FormField>
          {!q.online && <p className={s.hint} role="status">{t("cls.finish.offlineHint")}</p>}
          <div className="actions">
            <Button variant="secondary" onClick={() => setOpen(false)}>{t("cls.finish.cancel")}</Button>
            <Button onClick={confirm}>{t("cls.finish.confirm")}</Button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
