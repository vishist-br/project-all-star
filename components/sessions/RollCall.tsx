"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { recordAttendanceAction, updateSessionAction } from "@/app/[role]/_actions/sessions";
import { Avatar, Badge, type Tone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FormField, Select, TextInput } from "@/components/ui/Form";
import { Sheet } from "@/components/ui/Sheet";
import { EmptyState } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n";
import { buildAttendanceBody, EXCUSE_REASONS, type ExcuseReason, type MarkStatus } from "@/lib/offline/queue";
import { canComplete, markedRows, mergeRoster, nextStatus, summarize, type RowView } from "@/lib/offline/rollcall";
import type { SessionDetail, SessionWarning } from "@/lib/sessions/types";
import { describeError, WarningList } from "./WarningList";
import { useAttendanceQueue } from "./useAttendanceQueue";
import s from "./sessions.module.css";

const TONE: Record<string, Tone> = { present: "ok", absent: "warn", excused: "info", not_marked: "neutral" };

/**
 * One-tap roll call. Tap a row to cycle present and absent; "More" sets excused with a reason or
 * adds a note. Taps are saved on this device first (works offline) and sent in order when the
 * connection is there. Complete session needs a connection.
 */
export function RollCall({ detail, userId }: { detail: SessionDetail; userId: string }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const q = useAttendanceQueue(userId);
  const [moreFor, setMoreFor] = useState<RowView | null>(null);
  const [sessionNote, setSessionNote] = useState(detail.coachNote ?? "");
  const [completing, setCompleting] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<SessionWarning[]>([]);

  const roster = useMemo(() => detail.roster ?? [], [detail.roster]);
  const rows = useMemo(() => mergeRoster(roster, detail.id, q.queue, q.syncedFor.get(detail.id)), [roster, detail.id, q.queue, q.syncedFor]);
  const active = rows.filter((r) => r.tappable);
  const waitlisted = rows.filter((r) => !r.tappable);
  const counts = summarize(rows);
  const mine = q.queue.filter((i) => i.sessionId === detail.id);
  const waiting = mine.filter((i) => i.state === "queued").length;
  const refused = mine.filter((i) => i.state !== "queued");
  const completed = detail.status === "completed";

  function tap(r: RowView) {
    setProblem(null);
    q.mark({ sessionId: detail.id, memberId: r.memberId, status: nextStatus(r.attendance), note: r.note });
  }

  function markAllPresent() {
    setProblem(null);
    for (const r of active) if (r.attendance === "not_marked") q.mark({ sessionId: detail.id, memberId: r.memberId, status: "present" });
  }

  async function saveNote() {
    setSavingNote(true);
    setProblem(null);
    try {
      const res = await updateSessionAction(detail.id, { coachNote: sessionNote.trim() ? sessionNote.trim() : null });
      if (res.ok) toast(t("sess.note.saved"));
      else setProblem(describeError(t, res));
    } catch {
      setProblem(t("sess.err.offlineAction"));
    } finally {
      setSavingNote(false);
    }
  }

  async function complete() {
    setProblem(null);
    if (!q.online) {
      setProblem(t("sess.complete.needsOnline"));
      return;
    }
    setCompleting(true);
    try {
      await q.flush();
      const latest = mergeRoster(roster, detail.id, q.latest(), q.syncedFor.get(detail.id));
      const check = canComplete(latest);
      if (check !== "ok") {
        setProblem(t(`sess.complete.${check}` as MessageKey));
        return;
      }
      const body = buildAttendanceBody(
        markedRows(latest).map((r) => ({
          memberId: r.memberId,
          status: r.attendance as MarkStatus,
          reason: r.excusedReason,
          note: r.note,
          clientId: r.attendanceClientId!,
        })),
        { complete: true, coachNote: sessionNote.trim() ? sessionNote.trim() : null },
      );
      const res = await recordAttendanceAction(detail.id, body);
      if (res.ok) {
        setWarnings(res.data.warnings ?? []);
        toast(t("sess.complete.done"));
        router.refresh();
      } else setProblem(describeError(t, res));
    } catch {
      setProblem(t("sess.err.offlineAction"));
    } finally {
      setCompleting(false);
    }
  }

  const over = detail.capacity !== null && detail.bookedCount > detail.capacity;
  const shownWarnings: SessionWarning[] = [
    ...(detail.isHoliday ? [{ code: "on_holiday" as const, message: "" }] : []),
    ...(over ? [{ code: "over_capacity" as const, message: "" }] : []),
    ...warnings.filter((w) => w.code === "outside_availability"),
  ];

  if (roster.length === 0) {
    return <EmptyState title={t("sess.roster.empty.title")} text={t("sess.roster.empty.text")} />;
  }

  return (
    <div className={s.stack}>
      <WarningList warnings={shownWarnings} t={t} />

      <div className={s.countBar} role="group" aria-label={t("sess.counts.label")}>
        <Count n={counts.present} label={t("sess.status.present")} />
        <Count n={counts.absent} label={t("sess.status.absent")} />
        <Count n={counts.excused} label={t("sess.status.excused")} />
        <Count n={counts.notMarked} label={t("sess.status.not_marked")} />
      </div>

      <div className={`${s.syncBar}${waiting ? ` ${s.syncWaiting}` : ""}`} role="status" aria-live="polite" data-testid="sync-status">
        <span>
          {waiting > 0
            ? q.online
              ? t("sess.sync.waiting", { n: waiting })
              : t("sess.sync.waitingOffline", { n: waiting })
            : q.syncing
              ? t("sess.sync.syncing")
              : t("sess.sync.saved")}
        </span>
        {waiting > 0 && q.online && (
          <Button variant="secondary" onClick={() => void q.flush()} loading={q.syncing}>{t("sess.sync.now")}</Button>
        )}
      </div>
      {!q.online && <p className="muted small">{t("sess.sync.offlineHint")}</p>}
      {!q.persistent && <p className="muted small">{t("sess.sync.memoryOnly")}</p>}

      {refused.length > 0 && (
        <div className={s.syncBox} role="alert">
          <p><strong>{t("sess.sync.problems", { n: refused.length })}</strong></p>
          <ul>
            {refused.map((i) => (
              <li key={i.clientId}>
                {roster.find((r) => r.memberId === i.memberId)?.memberName ?? i.memberId}
                {": "}
                {i.state === "conflict" ? t("sess.sync.conflict") : t("sess.sync.failed")}
              </li>
            ))}
          </ul>
          <div>
            <Button variant="secondary" onClick={() => q.discardProblems(detail.id)}>{t("sess.sync.discard")}</Button>
          </div>
        </div>
      )}

      <div className={s.bar}>
        <Button variant="secondary" onClick={markAllPresent} disabled={counts.notMarked === 0}>{t("sess.markAll")}</Button>
        {counts.notMarked > 0 && <span className="muted small">{t("sess.notMarkedHint", { n: counts.notMarked })}</span>}
      </div>

      <ul className={s.rollList} aria-label={t("sess.roster.label")}>
        {active.map((r) => (
          <li key={r.memberId} className={s.rollRow}>
            <button
              type="button"
              className={s.rollMain}
              data-status={r.attendance}
              onClick={() => tap(r)}
            >
              <Avatar name={r.memberName} />
              <span className={s.rollText}>
                <span className={s.rollName}>{r.memberName}</span>
                <span className={s.chips}>
                  <Badge tone={TONE[r.attendance] ?? "neutral"}>
                    {t(`sess.status.${r.attendance}` as MessageKey)}
                    {r.attendance === "excused" && r.excusedReason ? ` · ${t(`sess.reason.${r.excusedReason}` as MessageKey)}` : ""}
                  </Badge>
                  {r.declaredReason && (
                    <Badge tone="info">{t("roll.declared.reason", { reason: t(`sess.reason.${r.declaredReason}` as MessageKey) })}</Badge>
                  )}
                  {r.source === "booked" && <Badge tone="neutral">{t("sess.source.booked")}</Badge>}
                  {r.sync === "queued" && <Badge tone="warn">{t("sess.row.queued")}</Badge>}
                  {(r.sync === "conflict" || r.sync === "failed") && <Badge tone="danger">{t("sess.row.notSaved")}</Badge>}
                  {r.justSaved && <Badge tone="ok">{t("sess.row.saved")}</Badge>}
                </span>
                {r.declaredNote && <span className={s.rollNote}>{r.declaredNote}</span>}
                {r.note && <span className={s.rollNote}>{r.note}</span>}
                <span className="sr-only">{t("sess.row.aria", { next: t(`sess.status.${nextStatus(r.attendance)}` as MessageKey) })}</span>
              </span>
            </button>
            <Button variant="secondary" className={s.moreBtn} onClick={() => setMoreFor(r)} aria-label={t("sess.row.more", { name: r.memberName })}>
              {t("sess.more")}
            </Button>
          </li>
        ))}
      </ul>

      {waitlisted.length > 0 && (
        <section aria-label={t("sess.waitlist.title")}>
          <h2 className={s.waitlistTitle}>{t("sess.waitlist.title")}</h2>
          <p className="muted small">{t("sess.waitlist.text")}</p>
          <ul className={s.rollList}>
            {waitlisted.map((r) => (
              <li key={r.memberId} className={s.rollMain} style={{ cursor: "default" }}>
                <Avatar name={r.memberName} />
                <span className={s.rollName}>{r.memberName}</span>
                <Badge tone="info">{t("sess.source.waitlisted")}</Badge>
              </li>
            ))}
          </ul>
        </section>
      )}

      <FormField label={t("sess.note.label")} hint={t("sess.note.hint")}>
        {(p) => (
          <textarea {...p} className={`input ${s.textarea}`} maxLength={1000} value={sessionNote} onChange={(e) => setSessionNote(e.target.value)} />
        )}
      </FormField>

      {problem && <p className={s.errorBox} role="alert">{problem}</p>}

      <div className={s.completeBar}>
        <div className={s.bar}>
          <Button variant="secondary" onClick={() => void saveNote()} loading={savingNote} disabled={!q.online}>{t("sess.note.save")}</Button>
          {!completed && (
            <Button onClick={() => void complete()} loading={completing} disabled={!q.online}>{t("sess.complete.button")}</Button>
          )}
          {completed && <Badge tone="ok">{t("sess.complete.already")}</Badge>}
        </div>
        {!q.online && <p className="muted small">{t("sess.complete.needsOnline")}</p>}
      </div>

      <MemberSheet
        row={moreFor}
        onClose={() => setMoreFor(null)}
        onSave={(status, reason, note) => {
          if (moreFor) q.mark({ sessionId: detail.id, memberId: moreFor.memberId, status, reason, note });
          setMoreFor(null);
        }}
      />
    </div>
  );
}

function Count({ n, label }: { n: number; label: string }) {
  return (
    <div className={s.count}>
      <span className={s.countNum}>{n}</span>
      <span className={s.countLabel}>{label}</span>
    </div>
  );
}

function MemberSheet({ row, onClose, onSave }: { row: RowView | null; onClose: () => void; onSave: (status: MarkStatus, reason: ExcuseReason | null, note: string | null) => void }) {
  const { t } = useI18n();
  return (
    <Sheet open={row !== null} title={row ? t("sess.more.title", { name: row.memberName }) : ""} closeLabel={t("sess.more.close")} onClose={onClose}>
      {row && <MemberSheetBody row={row} onSave={onSave} />}
    </Sheet>
  );
}

function MemberSheetBody({ row, onSave }: { row: RowView; onSave: (status: MarkStatus, reason: ExcuseReason | null, note: string | null) => void }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<MarkStatus>(row.attendance === "not_marked" ? "present" : row.attendance);
  const [reason, setReason] = useState<ExcuseReason | "">(row.excusedReason ?? "");
  const [note, setNote] = useState(row.note ?? "");
  const [err, setErr] = useState<string | null>(null);
  const choices: MarkStatus[] = ["present", "absent", "excused"];

  function save() {
    if (status === "excused" && !reason) {
      setErr(t("sess.more.reasonRequired"));
      return;
    }
    onSave(status, status === "excused" ? (reason as ExcuseReason) : null, note.trim() || null);
  }

  return (
    <div className={s.sheetBody}>
      <div className={s.choice} role="group" aria-label={t("sess.more.status")}>
        {choices.map((c) => (
          <Button key={c} variant="secondary" className={s.choiceBtn} aria-pressed={status === c} onClick={() => { setStatus(c); setErr(null); }}>
            {t(`sess.status.${c}` as MessageKey)}
          </Button>
        ))}
      </div>
      {status === "excused" && (
        <FormField label={t("sess.more.reason")} error={err ?? undefined}>
          {(p) => (
            <Select {...p} value={reason} onChange={(e) => { setReason(e.target.value as ExcuseReason | ""); setErr(null); }}>
              <option value="">{t("sess.more.reasonPick")}</option>
              {EXCUSE_REASONS.map((r) => <option key={r} value={r}>{t(`sess.reason.${r}` as MessageKey)}</option>)}
            </Select>
          )}
        </FormField>
      )}
      <FormField label={t("sess.more.note")} hint={t("sess.more.noteHint")}>
        {(p) => <TextInput {...p} maxLength={280} value={note} onChange={(e) => setNote(e.target.value)} />}
      </FormField>
      <div className="actions">
        <Button onClick={save}>{t("sess.more.save")}</Button>
      </div>
    </div>
  );
}
