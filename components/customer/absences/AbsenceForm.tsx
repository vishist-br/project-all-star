"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { declareAbsenceAction } from "@/app/[role]/_actions/absences";
import { Button, DateInput, FormField, Select, TextInput, useToast } from "@/components/ui";
import { ABSENCE_REASONS } from "@/lib/absences/rules";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n";
import s from "../Customer.module.css";

export type UpcomingSession = { id: string; label: string };

/** Tell the coach ahead of time: pick one upcoming session or a date range, a reason and an optional note. */
export function AbsenceForm({
  memberId,
  today,
  sessions,
  initialSessionId,
}: {
  memberId: string;
  today: string;
  sessions: UpcomingSession[];
  initialSessionId?: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const startsWithSession = sessions.some((x) => x.id === initialSessionId) || (sessions.length > 0 && !initialSessionId);
  const [mode, setMode] = useState<"session" | "dates">(startsWithSession ? "session" : "dates");
  const [sessionId, setSessionId] = useState(initialSessionId && sessions.some((x) => x.id === initialSessionId) ? initialSessionId : (sessions[0]?.id ?? ""));
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!reason) return setError(t("abs.err.reason"));
    if (mode === "session" && !sessionId) return setError(t("abs.err.session"));
    if (mode === "dates" && !fromDate) return setError(t("abs.err.dates"));
    start(async () => {
      const res = await declareAbsenceAction({
        memberId,
        reason,
        note: note.trim() || undefined,
        ...(mode === "session" ? { sessionId } : { fromDate, toDate: toDate || fromDate }),
      });
      if (res.ok) {
        toast(t("abs.toast.saved"), "ok");
        setNote("");
        setReason("");
        router.refresh();
      } else if (res.code === "conflict") setError(t("abs.err.already"));
      else if (res.code === "validation_failed") setError(t("abs.err.invalid"));
      else setError(t("abs.err.other"));
    });
  }

  return (
    <form onSubmit={submit} className={s.stack} aria-label={t("abs.form.title")} data-testid="absence-form">
      <div className={s.switcher} role="group" aria-label={t("abs.form.mode")}>
        <button type="button" className={s.chip} aria-pressed={mode === "session"} onClick={() => setMode("session")}>{t("abs.mode.session")}</button>
        <button type="button" className={s.chip} aria-pressed={mode === "dates"} onClick={() => setMode("dates")}>{t("abs.mode.dates")}</button>
      </div>
      {mode === "session" ? (
        sessions.length === 0 ? (
          <p className="muted">{t("abs.noSessions")}</p>
        ) : (
          <FormField label={t("abs.form.session")}>
            {(p) => (
              <Select {...p} value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
                {sessions.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </Select>
            )}
          </FormField>
        )
      ) : (
        <>
          <FormField label={t("abs.form.from")}>
            {(p) => <DateInput {...p} min={today} value={fromDate} onChange={(e) => setFromDate(e.target.value)} />}
          </FormField>
          <FormField label={t("abs.form.to")} hint={t("abs.form.toHint")}>
            {(p) => <DateInput {...p} min={fromDate || today} value={toDate} onChange={(e) => setToDate(e.target.value)} />}
          </FormField>
        </>
      )}
      <FormField label={t("abs.form.reason")}>
        {(p) => (
          <Select {...p} value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">{t("abs.form.reasonPick")}</option>
            {ABSENCE_REASONS.map((r) => <option key={r} value={r}>{t(`sess.reason.${r}` as MessageKey)}</option>)}
          </Select>
        )}
      </FormField>
      <FormField label={t("abs.form.note")} hint={t("abs.form.noteHint")}>
        {(p) => <TextInput {...p} maxLength={280} value={note} onChange={(e) => setNote(e.target.value)} />}
      </FormField>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="actions">
        <Button type="submit" loading={pending} disabled={mode === "session" && sessions.length === 0}>{t("abs.form.submit")}</Button>
      </div>
    </form>
  );
}
