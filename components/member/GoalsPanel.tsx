"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { addGoalCheckInAction, createGoalAction, setGoalStatusAction } from "@/app/[role]/_actions/goals";
import { Badge, ProgressBar, type Tone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DateInput, Select, TextInput } from "@/components/ui/Form";
import { EmptyState } from "@/components/ui/States";
import { ConfirmDialog, Sheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n";
import {
  GOAL_METRICS,
  checkInPayload,
  emptyGoalForm,
  goalPayload,
  validateCheckIn,
  validateGoalForm,
  type CheckInForm,
  type GoalError,
  type GoalForm,
} from "@/lib/members/goal-form";
import { shortDate } from "@/lib/members/view";
import s from "./member.module.css";

export type GoalView = {
  id: string;
  title: string;
  metric: string;
  status: string;
  targetValue: number | null;
  currentValue: number | null;
  unit: string | null;
  targetLevelName: string | null;
  targetDate: string | null;
  progressPercent: number;
  checkIns: { id: string; value: number; note: string | null; recordedOn: string }[];
};
export type LevelOption = { id: string; name: string; rank: number };

const TONE: Record<string, Tone> = { active: "info", achieved: "ok", dropped: "neutral" };

/** Goals of one member: progress bars, status changes, custom check-ins and a goal editor sheet. `canManage` hides every write control for read-only viewers. */
export function GoalsPanel({ memberId, goals, levels, canManage, today }: { memberId: string; goals: GoalView[]; levels: LevelOption[]; canManage: boolean; today: string }) {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [checkInFor, setCheckInFor] = useState<GoalView | null>(null);
  const [dropFor, setDropFor] = useState<GoalView | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function setStatus(g: GoalView, status: "active" | "achieved" | "dropped") {
    setBusyId(g.id);
    const res = await setGoalStatusAction(g.id, status);
    setBusyId(null);
    setDropFor(null);
    if (res.ok) {
      toast(t("goals.updated"));
      router.refresh();
    } else toast(t("goals.updateFailed"), "danger");
  }

  return (
    <Card title={t("goals.title")} actions={canManage ? <Button variant="secondary" onClick={() => setCreateOpen(true)}>{t("goals.new")}</Button> : undefined}>
      {goals.length === 0 ? (
        <EmptyState
          title={t("goals.empty.title")}
          text={canManage ? t("goals.empty.text") : undefined}
          action={canManage ? <Button onClick={() => setCreateOpen(true)}>{t("goals.new")}</Button> : undefined}
        />
      ) : (
        <ul className={s.list} aria-label={t("goals.title")}>
          {goals.map((g) => {
            const unit = g.unit ? ` ${g.unit}` : "";
            return (
              <li key={g.id} className={s.item}>
                <div className={s.itemHead}>
                  <h3 className={s.itemTitle}>{g.title}</h3>
                  <Badge tone={TONE[g.status] ?? "neutral"}>{t(`goals.status.${g.status}` as MessageKey)}</Badge>
                </div>
                <p className={s.meta}>
                  {t(`goals.metric.${g.metric}` as MessageKey)}
                  {g.metric === "level" && g.targetLevelName ? ` · ${t("goals.targetLevel", { name: g.targetLevelName })}` : ""}
                  {g.targetDate ? ` · ${t("goals.targetDate", { date: shortDate(g.targetDate, locale) })}` : ""}
                </p>
                <ProgressBar value={g.progressPercent} label={g.title} />
                <p className={s.meta}>
                  {t("goals.progress", { n: Math.round(g.progressPercent) })}
                  {g.metric !== "level" && g.targetValue !== null
                    ? ` · ${g.currentValue === null ? t("goals.noReading") : t("goals.now", { current: g.currentValue, target: g.targetValue, unit })}`
                    : ""}
                </p>
                {g.checkIns.length > 0 && (
                  <details>
                    <summary className="small">{t("goals.checkin.history")} ({g.checkIns.length})</summary>
                    <ul className={s.checkIns}>
                      {g.checkIns.slice(0, 8).map((c) => (
                        <li key={c.id}>{shortDate(c.recordedOn, locale)}: {c.value}{unit}{c.note ? ` · ${c.note}` : ""}</li>
                      ))}
                    </ul>
                  </details>
                )}
                {canManage && (
                  <div className={s.rowActions}>
                    {g.status === "active" && g.metric === "custom" && <Button variant="secondary" onClick={() => setCheckInFor(g)}>{t("goals.checkin.add")}</Button>}
                    {g.status === "active" && <Button variant="secondary" loading={busyId === g.id} onClick={() => void setStatus(g, "achieved")}>{t("goals.achieve")}</Button>}
                    {g.status === "active" && <Button variant="ghost" onClick={() => setDropFor(g)}>{t("goals.drop")}</Button>}
                    {g.status !== "active" && <Button variant="secondary" loading={busyId === g.id} onClick={() => void setStatus(g, "active")}>{t("goals.reopen")}</Button>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Sheet open={createOpen} title={t("goals.new")} closeLabel={t("goals.form.close")} onClose={() => setCreateOpen(false)}>
        <CreateGoalForm memberId={memberId} levels={levels} today={today} onDone={() => setCreateOpen(false)} />
      </Sheet>
      <Sheet open={checkInFor !== null} title={t("goals.checkin.title", { goal: checkInFor?.title ?? "" })} closeLabel={t("goals.form.close")} onClose={() => setCheckInFor(null)}>
        {checkInFor && <CheckInFormView goal={checkInFor} onDone={() => setCheckInFor(null)} />}
      </Sheet>
      <ConfirmDialog
        open={dropFor !== null}
        title={t("goals.dropDialog.title")}
        text={t("goals.dropDialog.text")}
        confirmLabel={t("goals.dropDialog.confirm")}
        cancelLabel={t("goals.dropDialog.cancel")}
        danger
        onConfirm={() => dropFor && void setStatus(dropFor, "dropped")}
        onCancel={() => setDropFor(null)}
      />
    </Card>
  );
}

const errText = (t: (k: MessageKey) => string, code: string) => t(`goals.err.${code}` as MessageKey);

function CreateGoalForm({ memberId, levels, today, onDone }: { memberId: string; levels: LevelOption[]; today: string; onDone: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [form, setForm] = useState<GoalForm>(emptyGoalForm);
  const [errs, setErrs] = useState<Partial<Record<keyof GoalForm, GoalError["code"]>>>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const set = <K extends keyof GoalForm>(k: K, v: GoalForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    setProblem(null);
    const found = validateGoalForm(form, today);
    setErrs(Object.fromEntries(found.map((e) => [e.field, e.code])));
    if (found.length > 0) return;
    setBusy(true);
    const res = await createGoalAction(memberId, goalPayload(form));
    setBusy(false);
    if (!res.ok) {
      setProblem(t("goals.form.failed"));
      return;
    }
    toast(t("goals.form.saved"));
    router.refresh();
    onDone();
  }

  const field = (k: keyof GoalForm) => ({ "aria-invalid": errs[k] ? (true as const) : undefined, "aria-describedby": errs[k] ? `g-${k}-err` : undefined });
  const err = (k: keyof GoalForm) => (errs[k] ? <p id={`g-${k}-err`} className="field-error">{errText(t, errs[k]!)}</p> : null);

  return (
    <form className={s.form} onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
      {problem && <p className="msg-error" role="alert">{problem}</p>}
      <div className="field">
        <label className="field-label" htmlFor="g-title">{t("goals.form.title")}</label>
        <TextInput id="g-title" value={form.title} onChange={(e) => set("title", e.target.value)} maxLength={160} autoComplete="off" {...field("title")} />
        {err("title")}
      </div>
      <div className="field">
        <label className="field-label" htmlFor="g-metric">{t("goals.form.metric")}</label>
        <Select id="g-metric" value={form.metric} onChange={(e) => set("metric", e.target.value as GoalForm["metric"])}>
          {GOAL_METRICS.map((m) => <option key={m} value={m}>{t(`goals.metric.${m}` as MessageKey)}</option>)}
        </Select>
      </div>
      {form.metric === "level" ? (
        <div className="field">
          <label className="field-label" htmlFor="g-targetLevelId">{t("goals.form.level")}</label>
          <Select id="g-targetLevelId" value={form.targetLevelId} onChange={(e) => set("targetLevelId", e.target.value)} {...field("targetLevelId")}>
            <option value="">{t("goals.form.chooseLevel")}</option>
            {levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
          {levels.length === 0 && <p className="field-hint">{t("goals.form.noLevels")}</p>}
          {err("targetLevelId")}
        </div>
      ) : (
        <div className={s.twoCol}>
          <div className="field">
            <label className="field-label" htmlFor="g-targetValue">{t("goals.form.target")}</label>
            <TextInput id="g-targetValue" inputMode="decimal" value={form.targetValue} onChange={(e) => set("targetValue", e.target.value)} autoComplete="off" {...field("targetValue")} />
            {err("targetValue")}
          </div>
          {form.metric === "custom" && (
            <div className="field">
              <label className="field-label" htmlFor="g-startValue">{t("goals.form.startValue")}</label>
              <TextInput id="g-startValue" inputMode="decimal" value={form.startValue} onChange={(e) => set("startValue", e.target.value)} autoComplete="off" {...field("startValue")} />
              {err("startValue")}
            </div>
          )}
          <div className="field">
            <label className="field-label" htmlFor="g-unit">{t("goals.form.unit")}</label>
            <TextInput id="g-unit" value={form.unit} onChange={(e) => set("unit", e.target.value)} autoComplete="off" {...field("unit")} />
            {err("unit")}
          </div>
        </div>
      )}
      <div className="field">
        <label className="field-label" htmlFor="g-targetDate">{t("goals.form.targetDate")}</label>
        <DateInput id="g-targetDate" min={today} value={form.targetDate} onChange={(e) => set("targetDate", e.target.value)} {...field("targetDate")} />
        {err("targetDate")}
      </div>
      <div className="actions">
        <Button type="submit" loading={busy}>{t("goals.form.save")}</Button>
      </div>
    </form>
  );
}

function CheckInFormView({ goal, onDone }: { goal: GoalView; onDone: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [form, setForm] = useState<CheckInForm>({ value: "", note: "" });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit() {
    setProblem(null);
    const found = validateCheckIn(form);
    setErrs(Object.fromEntries(found.map((e) => [e.field, errText(t, e.code)])));
    if (found.length > 0) return;
    setBusy(true);
    const res = await addGoalCheckInAction(goal.id, checkInPayload(form));
    setBusy(false);
    if (!res.ok) {
      setProblem(t("goals.checkin.failed"));
      return;
    }
    toast(t("goals.checkin.saved"));
    router.refresh();
    onDone();
  }

  return (
    <form className={s.form} onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
      {problem && <p className="msg-error" role="alert">{problem}</p>}
      <div className="field">
        <label className="field-label" htmlFor="ci-value">{t("goals.checkin.value")}{goal.unit ? ` (${goal.unit})` : ""}</label>
        <TextInput id="ci-value" inputMode="decimal" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} autoComplete="off" aria-invalid={errs.value ? true : undefined} />
        {errs.value && <p className="field-error">{errs.value}</p>}
      </div>
      <div className="field">
        <label className="field-label" htmlFor="ci-note">{t("goals.checkin.note")}</label>
        <TextInput id="ci-note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} autoComplete="off" aria-invalid={errs.note ? true : undefined} />
        {errs.note && <p className="field-error">{errs.note}</p>}
      </div>
      <div className="actions">
        <Button type="submit" loading={busy}>{t("goals.checkin.save")}</Button>
      </div>
    </form>
  );
}
