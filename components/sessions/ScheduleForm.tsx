"use client";
import { useRef, useState } from "react";
import { createSessionAction } from "@/app/[role]/_actions/sessions";
import { Button, ButtonLink } from "@/components/ui/Button";
import { DateInput, FormField, Select, TextInput } from "@/components/ui/Form";
import { EmptyState } from "@/components/ui/States";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n";
import { newClientId } from "@/lib/offline/queue";
import { buildCreatePayload, validateSchedule, type ScheduleInput, type ScheduleMode } from "@/lib/sessions/form";
import type { BatchOption, MemberChoice, SessionDetail } from "@/lib/sessions/types";
import { describeError, WarningList } from "./WarningList";
import s from "./sessions.module.css";

/** Schedule a batch session or a one-on-one. Warnings (availability, holiday, capacity) never block; overlaps (409) are explained. */
export function ScheduleForm({ role, batches, members, defaultDate }: { role: string; batches: BatchOption[]; members: MemberChoice[]; defaultDate: string }) {
  const { t } = useI18n();
  const [input, setInput] = useState<ScheduleInput>({
    mode: batches.length === 0 && members.length > 0 ? "member" : "batch",
    batchId: "",
    memberId: "",
    date: defaultDate,
    startTime: "17:00",
    endTime: "18:00",
    capacity: "",
    title: "",
  });
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [created, setCreated] = useState<SessionDetail | null>(null);
  // One id per form: a double tap on Save creates one session, not two.
  const clientId = useRef(newClientId());

  const errors = validateSchedule(input);
  const err = (f: string) => {
    const e = errors.find((x) => x.field === f);
    return shown && e ? t(`sess.err.${e.code}` as MessageKey) : undefined;
  };
  const set = (patch: Partial<ScheduleInput>) => {
    setInput((cur) => ({ ...cur, ...patch }));
    setProblem(null);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setShown(true);
    setProblem(null);
    if (errors.length) return;
    setBusy(true);
    try {
      const res = await createSessionAction(buildCreatePayload(input, clientId.current));
      if (res.ok) setCreated(res.data);
      else setProblem(describeError(t, res));
    } catch {
      setProblem(t("sess.err.offlineAction"));
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <div className={s.okBox} role="status">
        <h2>{t("sess.schedule.done")}</h2>
        <p>{t("sess.schedule.doneText", { name: created.title ?? created.batchName })}</p>
        <WarningList warnings={created.warnings ?? []} t={t} />
        <div className="actions">
          <ButtonLink href={`/${role}/sessions/${created.id}`}>{t("sess.schedule.open")}</ButtonLink>
          <Button
            variant="secondary"
            onClick={() => {
              clientId.current = newClientId();
              setCreated(null);
              setShown(false);
            }}
          >
            {t("sess.schedule.another")}
          </Button>
          <ButtonLink variant="ghost" href={`/${role}/today/week`}>{t("sess.schedule.week")}</ButtonLink>
        </div>
      </div>
    );
  }

  if (batches.length === 0 && members.length === 0) {
    return <EmptyState title={t("sess.schedule.nothing.title")} text={t("sess.schedule.nothing.text")} />;
  }

  const modes: ScheduleMode[] = ["batch", "member"];
  return (
    <form className={s.form} onSubmit={(e) => void submit(e)} noValidate aria-label={t("sess.schedule.title")}>
      <div className={s.choice} style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }} role="group" aria-label={t("sess.schedule.kind")}>
        {modes.map((m) => (
          <Button key={m} variant="secondary" className={s.choiceBtn} aria-pressed={input.mode === m} onClick={() => set({ mode: m })}>
            {t(m === "batch" ? "sess.schedule.kind.batch" : "sess.schedule.kind.member")}
          </Button>
        ))}
      </div>

      {input.mode === "batch" ? (
        <FormField label={t("sess.f.batch")} error={err("batchId")}>
          {(p) => (
            <Select {...p} value={input.batchId} onChange={(e) => set({ batchId: e.target.value })}>
              <option value="">{t("sess.f.pick")}</option>
              {batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          )}
        </FormField>
      ) : (
        <FormField label={t("sess.f.member")} error={err("memberId")}>
          {(p) => (
            <Select {...p} value={input.memberId} onChange={(e) => set({ memberId: e.target.value })}>
              <option value="">{t("sess.f.pick")}</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          )}
        </FormField>
      )}

      <FormField label={t("sess.f.date")} error={err("date")}>
        {(p) => <DateInput {...p} value={input.date} onChange={(e) => set({ date: e.target.value })} />}
      </FormField>
      <div className={s.twoCol}>
        <FormField label={t("sess.f.start")} error={err("startTime")}>
          {(p) => <TextInput {...p} type="time" value={input.startTime} onChange={(e) => set({ startTime: e.target.value })} />}
        </FormField>
        <FormField label={t("sess.f.end")} error={err("endTime")}>
          {(p) => <TextInput {...p} type="time" value={input.endTime} onChange={(e) => set({ endTime: e.target.value })} />}
        </FormField>
      </div>
      {input.mode === "batch" && (
        <FormField label={t("sess.f.capacity")} hint={t("sess.f.capacityHint")} error={err("capacity")}>
          {(p) => <TextInput {...p} inputMode="numeric" value={input.capacity} onChange={(e) => set({ capacity: e.target.value })} />}
        </FormField>
      )}
      <FormField label={t("sess.f.title")} hint={t("sess.f.titleHint")} error={err("title")}>
        {(p) => <TextInput {...p} maxLength={80} value={input.title} onChange={(e) => set({ title: e.target.value })} />}
      </FormField>

      {problem && <p className={s.errorBox} role="alert">{problem}</p>}
      <div className={s.saveBar}>
        <Button type="submit" loading={busy}>{t("sess.schedule.save")}</Button>
        <ButtonLink variant="ghost" href={`/${role}/today`}>{t("sess.keep")}</ButtonLink>
      </div>
    </form>
  );
}
