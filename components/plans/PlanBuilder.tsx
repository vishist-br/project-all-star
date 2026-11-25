"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createPlanAction, updatePlanAction } from "@/app/[role]/_actions/plans";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Select, TextInput } from "@/components/ui/Form";
import { useToast } from "@/components/ui/Toast";
import type { MessageKey } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import type { ExerciseFacets } from "@/lib/plans/facets";
import {
  CADENCES,
  addDay,
  buildPayload,
  changeCadence,
  emptyForm,
  emptyItem,
  formFromPlan,
  freeDayIndexes,
  removeDay,
  setDayIndex,
  updateDay,
  validateForm,
  type Cadence,
  type FormError,
  type PlanForm,
  type PlanLike,
} from "@/lib/plans/form";
import { PlanItemsEditor } from "@/components/workout/builder/PlanItemsEditor";
import { ExercisePicker } from "./ExercisePicker";
import s from "./plans.module.css";

export type EditablePlan = PlanLike & { id: string; version: number; status: string };

const idFor = (path: string) => `pf-${path.replace(/[^\w]/g, "-")}`;

/** Create or edit a plan. Saving as draft or active goes through server actions (no tokens in the browser). */
export function PlanBuilder({ role, plan, facets }: { role: string; plan?: EditablePlan; facets: ExerciseFacets }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [form, setForm] = useState<PlanForm>(() => (plan ? formFromPlan(plan) : emptyForm()));
  const [errors, setErrors] = useState<FormError[]>([]);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<"draft" | "active" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [pickerDay, setPickerDay] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [announcement, setAnnouncement] = useState("");

  const listHref = `/${role}/plans`;

  const dayName = (cadence: Cadence, n: number) =>
    cadence === "daily" ? t("plans.day.every") : cadence === "weekly" ? t(`plans.weekday.${n}` as MessageKey) : t("plans.day.monthly", { n });

  function errText(e: FormError): string {
    switch (e.code) {
      case "required":
        return t("plans.err.required");
      case "tooLong":
        return t("plans.err.tooLong", { max: e.params?.max ?? 0 });
      case "range":
        return t("plans.err.range", { min: e.params?.min ?? 0, max: e.params?.max ?? 0 });
      case "measure":
        return t("pb.err.measure");
      case "noExercises":
        return t("plans.err.noExercises");
      case "tooManyItems":
        return t("plans.err.tooManyItems", { max: e.params?.max ?? 0 });
      case "group":
        return t("pb.err.group");
      case "weight":
        return t("pb.err.weight");
    }
  }
  const msg = (path: string): string | undefined => {
    const e = errors.find((x) => x.path === path);
    return e ? errText(e) : serverErrors[path] ? t("plans.err.server") : undefined;
  };
  const fieldProps = (path: string) => {
    const m = msg(path);
    return { id: idFor(path), "aria-invalid": m ? (true as const) : undefined, "aria-describedby": m ? `${idFor(path)}-err` : undefined };
  };
  const fieldError = (path: string) => {
    const m = msg(path);
    return m ? <p id={`${idFor(path)}-err`} className="field-error">{m}</p> : null;
  };

  function focusFirst(list: FormError[]) {
    const first = list[0];
    if (!first) return;
    const target = first.code === "measure" ? `${first.path}.reps` : first.path;
    requestAnimationFrame(() => document.getElementById(idFor(target))?.focus());
  }

  async function save(status: "draft" | "active") {
    setProblem(null);
    setServerErrors({});
    const found = validateForm(form, status);
    setErrors(found);
    if (found.length > 0) {
      focusFirst(found);
      return;
    }
    setSaving(status);
    const payload = buildPayload(form, status, plan?.version);
    const res = plan ? await updatePlanAction(plan.id, payload) : await createPlanAction(payload);
    setSaving(null);
    if (res.ok) {
      toast(status === "active" ? t("plans.builder.savedActive") : t("plans.builder.savedDraft"));
      router.push(listHref);
      router.refresh();
      return;
    }
    if (res.code === "conflict") {
      if (/archived/i.test(res.message)) setProblem(t("plans.builder.archivedNotice"));
      else setConflict(true);
    } else if (res.code === "validation_failed") {
      const map: Record<string, string> = {};
      for (const d of res.details ?? []) map[d.field] = d.message;
      setServerErrors(map);
      setProblem(t("plans.builder.fixErrors"));
    } else if (res.code === "forbidden") setProblem(t("plans.builder.notYours"));
    else if (res.code === "not_found") setProblem(t("plans.builder.gone"));
    else setProblem(t("plans.builder.saveFailed"));
  }

  if (conflict) {
    return (
      <div className={s.notice} role="alert">
        <h2>{t("plans.conflict.title")}</h2>
        <p>{t("plans.conflict.text")}</p>
        <div className="actions">
          <Button onClick={() => window.location.reload()}>{t("plans.conflict.reload")}</Button>
          <ButtonLink variant="secondary" href={listHref}>{t("plans.backToList")}</ButtonLink>
        </div>
      </div>
    );
  }

  const pickerTarget = form.days.find((d) => d.key === pickerDay);
  const busy = saving !== null;
  const freeDays = freeDayIndexes(form);

  return (
    <>
      <form className={s.builder} onSubmit={(e) => e.preventDefault()} noValidate aria-label={plan ? t("plans.builder.editTitle") : t("plans.builder.newTitle")}>
        {problem && <p className={s.summaryError} role="alert">{problem}</p>}

        <Card>
          <div className="stack">
            <div className="field">
              <label className="field-label" htmlFor={idFor("title")}>{t("plans.builder.name")}</label>
              <TextInput {...fieldProps("title")} value={form.title} maxLength={200} onChange={(e) => setForm({ ...form, title: e.target.value })} autoComplete="off" />
              {fieldError("title")}
            </div>
            <div className="field">
              <label className="field-label" htmlFor={idFor("description")}>{t("plans.builder.description")}</label>
              <textarea {...fieldProps("description")} className={`input ${s.textarea}`} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              {fieldError("description")}
            </div>
            <div className={s.twoCol}>
              <div className="field">
                <label className="field-label" htmlFor={idFor("cadence")}>{t("plans.cadence")}</label>
                <Select id={idFor("cadence")} value={form.cadence} aria-describedby={`${idFor("cadence")}-hint`} onChange={(e) => setForm(changeCadence(form, e.target.value as Cadence))}>
                  {CADENCES.map((c) => <option key={c} value={c}>{t(`plans.cadence.${c}` as MessageKey)}</option>)}
                </Select>
                <p id={`${idFor("cadence")}-hint`} className="field-hint">{t(`plans.cadenceHint.${form.cadence}` as MessageKey)}</p>
              </div>
              <div className="field">
                <label className="field-label" htmlFor={idFor("sportSlug")}>{t("plans.builder.sport")}</label>
                <Select id={idFor("sportSlug")} value={form.sportSlug} onChange={(e) => setForm({ ...form, sportSlug: e.target.value })}>
                  <option value="">{t("plans.builder.anySport")}</option>
                  {facets.sports.map((sp) => <option key={sp} value={sp}>{sp}</option>)}
                </Select>
              </div>
            </div>
          </div>
        </Card>

        <h2 className="card-title">{t("plans.builder.days")}</h2>
        {msg("days") && <p id={`${idFor("days")}-err`} className="field-error" role="alert">{msg("days")}</p>}

        {form.days.map((day, di) => (
          <Card key={day.key} as="section" className={s.day}>
            <div className={s.dayHead}>
              {form.cadence === "daily" ? (
                <h3 className={s.dayName}>{dayName(form.cadence, day.dayIndex)}</h3>
              ) : (
                <div className="field">
                  <label className="field-label" htmlFor={idFor(`days[${di}].dayIndex`)}>{t("plans.day.which")}</label>
                  <Select {...fieldProps(`days[${di}].dayIndex`)} value={day.dayIndex} onChange={(e) => setForm(setDayIndex(form, day.key, Number(e.target.value)))}>
                    {[day.dayIndex, ...freeDays].sort((a, b) => a - b).map((n) => <option key={n} value={n}>{dayName(form.cadence, n)}</option>)}
                  </Select>
                  {fieldError(`days[${di}].dayIndex`)}
                </div>
              )}
              {form.days.length > 1 && (
                <Button variant="ghost" onClick={() => setForm(removeDay(form, day.key))}>{t("plans.day.remove")}</Button>
              )}
            </div>

            <div className="field">
              <label className="field-label" htmlFor={idFor(`days[${di}].title`)}>{t("plans.day.title")}</label>
              <TextInput {...fieldProps(`days[${di}].title`)} value={day.title} onChange={(e) => setForm(updateDay(form, day.key, (d) => ({ ...d, title: e.target.value })))} autoComplete="off" />
              {fieldError(`days[${di}].title`)}
            </div>

            {day.items.length === 0 ? (
              <p className={s.emptyDay}>{t("plans.day.empty")}</p>
            ) : (
              <PlanItemsEditor
                items={day.items}
                onChange={(items) => setForm((f) => updateDay(f, day.key, (d) => ({ ...d, items })))}
                basePath={`days[${di}]`}
                selected={selected}
                onSelectedChange={setSelected}
                onAnnounce={(text) => {
                  setAnnouncement(text);
                  toast(text);
                }}
                helpers={{ idFor, fieldProps, fieldError, msg }}
              />
            )}
            <div>
              <Button id={di === 0 ? idFor("days") : undefined} variant="secondary" onClick={() => setPickerDay(day.key)}>
                + {t("plans.item.addExercise")}
              </Button>
            </div>
          </Card>
        ))}

        {form.cadence !== "daily" && (
          <div>
            {freeDays.length > 0 ? (
              <Button variant="secondary" onClick={() => setForm(addDay(form))}>+ {t("plans.day.add")}</Button>
            ) : (
              <p className="muted small">{t("plans.day.allUsed")}</p>
            )}
          </div>
        )}

        <div className={s.saveBar}>
          <Button variant="secondary" loading={saving === "draft"} disabled={busy} onClick={() => void save("draft")}>{t("plans.builder.saveDraft")}</Button>
          <Button loading={saving === "active"} disabled={busy} onClick={() => void save("active")}>{t("plans.builder.saveActive")}</Button>
          <ButtonLink variant="ghost" href={listHref}>{t("plans.backToList")}</ButtonLink>
        </div>
      </form>

      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
      <ExercisePicker
        open={pickerDay !== null && !!pickerTarget}
        dayLabel={pickerTarget ? dayName(form.cadence, pickerTarget.dayIndex) : ""}
        facets={facets}
        defaultSport={form.sportSlug}
        onAdd={(ex) => {
          const target = pickerDay;
          if (target) setForm((f) => updateDay(f, target, (d) => ({ ...d, items: [...d.items, emptyItem(ex)] })));
        }}
        onClose={() => setPickerDay(null)}
      />
    </>
  );
}
