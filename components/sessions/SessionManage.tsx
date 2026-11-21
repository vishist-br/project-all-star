"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { updateSessionAction } from "@/app/[role]/_actions/sessions";
import { Button } from "@/components/ui/Button";
import { DateInput, FormField, TextInput } from "@/components/ui/Form";
import { Sheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n";
import { buildCancelPayload, buildReschedulePayload, validateWindow } from "@/lib/sessions/form";
import type { SessionDetail, SessionWarning } from "@/lib/sessions/types";
import { istDate, istTime } from "@/lib/sessions/week";
import { describeError, WarningList } from "./WarningList";
import s from "./sessions.module.css";

/** Reschedule and cancel for a scheduled session. Cancel asks first and tells members through their updates feed. */
export function SessionManage({ detail }: { detail: SessionDetail }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"reschedule" | "cancel" | null>(null);
  if (detail.status !== "scheduled") return null;
  return (
    <>
      <div className={s.rowActions}>
        <Button variant="secondary" onClick={() => setMode("reschedule")}>{t("sess.reschedule.button")}</Button>
        <Button variant="ghost" onClick={() => setMode("cancel")}>{t("sess.cancel.button")}</Button>
      </div>
      <Sheet open={mode === "reschedule"} title={t("sess.reschedule.title")} closeLabel={t("sess.close")} onClose={() => setMode(null)}>
        <RescheduleBody detail={detail} onClose={() => setMode(null)} />
      </Sheet>
      <Sheet open={mode === "cancel"} title={t("sess.cancel.title")} closeLabel={t("sess.close")} onClose={() => setMode(null)}>
        <CancelBody detail={detail} onClose={() => setMode(null)} />
      </Sheet>
    </>
  );
}

function RescheduleBody({ detail, onClose }: { detail: SessionDetail; onClose: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [date, setDate] = useState(istDate(detail.startsAt));
  const [start, setStart] = useState(istTime(detail.startsAt));
  const [end, setEnd] = useState(istTime(detail.endsAt));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<SessionWarning[]>([]);
  const errs = validateWindow(date, start, end);
  const err = (f: string) => {
    const e = errs.find((x) => x.field === f);
    return e ? t(`sess.err.${e.code}` as MessageKey) : undefined;
  };
  const [shown, setShown] = useState(false);

  async function save() {
    setShown(true);
    setProblem(null);
    if (errs.length) return;
    setBusy(true);
    try {
      const res = await updateSessionAction(detail.id, buildReschedulePayload(date, start, end));
      if (res.ok) {
        const w = res.data.warnings ?? [];
        toast(t("sess.reschedule.done"));
        router.refresh();
        if (w.length) setWarnings(w);
        else onClose();
      } else setProblem(describeError(t, res));
    } catch {
      setProblem(t("sess.err.offlineAction"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.sheetBody}>
      <FormField label={t("sess.f.date")} error={shown ? err("date") : undefined}>
        {(p) => <DateInput {...p} value={date} onChange={(e) => setDate(e.target.value)} />}
      </FormField>
      <div className={s.twoCol}>
        <FormField label={t("sess.f.start")} error={shown ? err("startTime") : undefined}>
          {(p) => <TextInput {...p} type="time" value={start} onChange={(e) => setStart(e.target.value)} />}
        </FormField>
        <FormField label={t("sess.f.end")} error={shown ? err("endTime") : undefined}>
          {(p) => <TextInput {...p} type="time" value={end} onChange={(e) => setEnd(e.target.value)} />}
        </FormField>
      </div>
      <WarningList warnings={warnings} t={t} />
      {problem && <p className={s.errorBox} role="alert">{problem}</p>}
      <div className="actions">
        {warnings.length > 0 ? (
          <Button onClick={onClose}>{t("sess.close")}</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>{t("sess.keep")}</Button>
            <Button loading={busy} onClick={() => void save()}>{t("sess.reschedule.confirm")}</Button>
          </>
        )}
      </div>
    </div>
  );
}

function CancelBody({ detail, onClose }: { detail: SessionDetail; onClose: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function cancel() {
    setBusy(true);
    setProblem(null);
    try {
      const res = await updateSessionAction(detail.id, buildCancelPayload(reason));
      if (res.ok) {
        toast(t("sess.cancel.done"));
        onClose();
        router.refresh();
      } else setProblem(describeError(t, res));
    } catch {
      setProblem(t("sess.err.offlineAction"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.sheetBody}>
      <p>{t("sess.cancel.text", { n: detail.bookedCount + detail.waitlistCount })}</p>
      <FormField label={t("sess.cancel.reason")} hint={t("sess.cancel.reasonHint")}>
        {(p) => <TextInput {...p} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />}
      </FormField>
      {problem && <p className={s.errorBox} role="alert">{problem}</p>}
      <div className="actions">
        <Button variant="secondary" onClick={onClose}>{t("sess.keep")}</Button>
        <Button variant="danger" loading={busy} onClick={() => void cancel()}>{t("sess.cancel.confirm")}</Button>
      </div>
    </div>
  );
}
