"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { assignPlanAction } from "@/app/[role]/_actions/plans";
import { setAssignmentStatusAction } from "@/app/[role]/_actions/members";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DateInput, Select, TextInput } from "@/components/ui/Form";
import { EmptyState } from "@/components/ui/States";
import { ConfirmDialog, Sheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n";
import { percentText, shortDate } from "@/lib/members/view";
import { todayInTenantZone, validateAssign } from "@/lib/plans/form";
import s from "./member.module.css";

export type AssignmentView = { id: string; planTitle: string; status: string; startsOn: string; endsOn: string | null; adherencePercent: number | null; note: string | null };
export type PlanOption = { id: string; title: string };

const TONE: Record<string, Tone> = { active: "ok", paused: "warn", ended: "neutral" };

/** Plans assigned to one member, with pause, resume, end and an "assign a plan" sheet (reuses assignPlanAction from the plans screens). */
export function AssignmentsPanel({ role, member, assignments, plans, canManage }: { role: string; member: { id: string; name: string }; assignments: AssignmentView[]; plans: PlanOption[]; canManage: boolean }) {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [endFor, setEndFor] = useState<AssignmentView | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function setStatus(a: AssignmentView, status: "active" | "paused" | "ended") {
    setBusyId(a.id);
    const res = await setAssignmentStatusAction(a.id, status);
    setBusyId(null);
    setEndFor(null);
    if (res.ok) {
      toast(t("plans.member.updated"));
      router.refresh();
    } else toast(t("plans.member.updateFailed"), "danger");
  }

  const dates = (a: AssignmentView) =>
    a.endsOn ? t("plans.member.fromTo", { start: shortDate(a.startsOn, locale), end: shortDate(a.endsOn, locale) }) : t("plans.member.from", { start: shortDate(a.startsOn, locale) });

  return (
    <Card title={t("plans.member.title")} actions={canManage ? <Button variant="secondary" onClick={() => setOpen(true)}>{t("plans.member.assign")}</Button> : undefined}>
      {assignments.length === 0 ? (
        <EmptyState
          title={t("plans.member.empty.title")}
          text={canManage ? t("plans.member.empty.text") : undefined}
          action={canManage ? <Button onClick={() => setOpen(true)}>{t("plans.member.assign")}</Button> : undefined}
        />
      ) : (
        <ul className={s.list} aria-label={t("plans.member.title")}>
          {assignments.map((a) => (
            <li key={a.id} className={s.item}>
              <div className={s.itemHead}>
                <h3 className={s.itemTitle}>{a.planTitle}</h3>
                <Badge tone={TONE[a.status] ?? "neutral"}>{t(`plans.member.status.${a.status}` as MessageKey)}</Badge>
              </div>
              <p className={s.meta}>
                {dates(a)} · {t("plans.member.adherence", { value: percentText(a.adherencePercent, t("roster.notEnough")) })}
              </p>
              {a.note && <p className={s.meta}>{a.note}</p>}
              {canManage && a.status !== "ended" && (
                <div className={s.rowActions}>
                  {a.status === "active" && <Button variant="secondary" loading={busyId === a.id} onClick={() => void setStatus(a, "paused")}>{t("plans.member.pause")}</Button>}
                  {a.status === "paused" && <Button variant="secondary" loading={busyId === a.id} onClick={() => void setStatus(a, "active")}>{t("plans.member.resume")}</Button>}
                  <Button variant="ghost" onClick={() => setEndFor(a)}>{t("plans.member.end")}</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <Sheet open={open} title={t("plans.member.sheetTitle", { name: member.name })} closeLabel={t("plans.member.close")} onClose={() => setOpen(false)}>
        <AssignForm role={role} member={member} plans={plans} onDone={() => setOpen(false)} />
      </Sheet>
      <ConfirmDialog
        open={endFor !== null}
        title={t("plans.member.endDialog.title")}
        text={t("plans.member.endDialog.text")}
        confirmLabel={t("plans.member.endDialog.confirm")}
        cancelLabel={t("plans.member.endDialog.cancel")}
        danger
        onConfirm={() => endFor && void setStatus(endFor, "ended")}
        onCancel={() => setEndFor(null)}
      />
    </Card>
  );
}

function AssignForm({ role, member, plans, onDone }: { role: string; member: { id: string; name: string }; plans: PlanOption[]; onDone: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [planId, setPlanId] = useState("");
  const [startsOn, setStartsOn] = useState(() => todayInTenantZone());
  const [endsOn, setEndsOn] = useState("");
  const [note, setNote] = useState("");
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (plans.length === 0) {
    return (
      <div className={s.form}>
        <p>{t("plans.member.noActive")}</p>
        <div className="actions"><ButtonLink href={`/${role}/plans/new`}>{t("plans.member.createPlan")}</ButtonLink></div>
      </div>
    );
  }

  async function submit() {
    setProblem(null);
    const map: Record<string, string> = {};
    if (!planId) map.plan = t("plans.member.errPlan");
    for (const e of validateAssign({ memberIds: [member.id], startsOn, endsOn, note })) {
      if (e.field === "endsOn") map.endsOn = t("plans.member.errDates");
      else if (e.field === "startsOn") map.startsOn = t("plans.assignSheet.errStart");
      else if (e.field === "note") map.note = t("plans.assignSheet.errNote");
    }
    setErrs(map);
    if (Object.keys(map).length > 0) return;
    setBusy(true);
    const res = await assignPlanAction({ planId, members: [{ id: member.id, name: member.name }], startsOn, endsOn: endsOn || null, note: note.trim() || null });
    setBusy(false);
    if (!res.ok) {
      setProblem(t("plans.member.failed"));
      return;
    }
    const outcome = res.data[0];
    if (outcome && !outcome.ok) {
      setProblem(outcome.code === "conflict" ? t("plans.member.conflict") : t("plans.member.failed"));
      return;
    }
    toast(t("plans.member.assigned"));
    router.refresh();
    onDone();
  }

  return (
    <form className={s.form} onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
      {problem && <p className="msg-error" role="alert">{problem}</p>}
      <div className="field">
        <label className="field-label" htmlFor="ma-plan">{t("plans.member.pick")}</label>
        <Select id="ma-plan" value={planId} onChange={(e) => setPlanId(e.target.value)} aria-invalid={errs.plan ? true : undefined}>
          <option value="">{t("plans.member.pickPlaceholder")}</option>
          {plans.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
        </Select>
        {errs.plan && <p className="field-error">{errs.plan}</p>}
      </div>
      <div className={s.twoCol}>
        <div className="field">
          <label className="field-label" htmlFor="ma-start">{t("plans.member.start")}</label>
          <DateInput id="ma-start" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} aria-invalid={errs.startsOn ? true : undefined} />
          {errs.startsOn && <p className="field-error">{errs.startsOn}</p>}
        </div>
        <div className="field">
          <label className="field-label" htmlFor="ma-end">{t("plans.member.endDate")}</label>
          <DateInput id="ma-end" value={endsOn} min={startsOn} onChange={(e) => setEndsOn(e.target.value)} aria-invalid={errs.endsOn ? true : undefined} />
          {errs.endsOn && <p className="field-error">{errs.endsOn}</p>}
        </div>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="ma-note">{t("plans.member.note")}</label>
        <TextInput id="ma-note" value={note} onChange={(e) => setNote(e.target.value)} autoComplete="off" aria-invalid={errs.note ? true : undefined} />
        {errs.note && <p className="field-error">{errs.note}</p>}
      </div>
      <div className="actions">
        <Button type="submit" loading={busy}>{t("plans.member.submit")}</Button>
      </div>
    </form>
  );
}
