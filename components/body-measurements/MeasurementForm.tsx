"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { recordMeasurementAction } from "@/app/[role]/_actions/plans-library";
import { Button } from "@/components/ui/Button";
import { DateInput, TextInput } from "@/components/ui/Form";
import { useToast } from "@/components/ui/Toast";
import { parseNumberInput } from "@/lib/gym-extras/view";
import { useI18n } from "@/lib/i18n/client";
import s from "./body.module.css";

type FieldKey = "weightKg" | "bodyFatPct" | "chestCm" | "waistCm" | "hipCm" | "armCm" | "thighCm";
const FIELDS: { key: FieldKey; label: "gx.bm.weightLabel" | "gx.bm.bodyFatLabel" | "gx.bm.chestLabel" | "gx.bm.waistLabel" | "gx.bm.hipLabel" | "gx.bm.armLabel" | "gx.bm.thighLabel"; min: number; max: number }[] = [
  { key: "weightKg", label: "gx.bm.weightLabel", min: 10, max: 400 },
  { key: "bodyFatPct", label: "gx.bm.bodyFatLabel", min: 2, max: 70 },
  { key: "chestCm", label: "gx.bm.chestLabel", min: 20, max: 250 },
  { key: "waistCm", label: "gx.bm.waistLabel", min: 20, max: 250 },
  { key: "hipCm", label: "gx.bm.hipLabel", min: 20, max: 250 },
  { key: "armCm", label: "gx.bm.armLabel", min: 10, max: 100 },
  { key: "thighCm", label: "gx.bm.thighLabel", min: 15, max: 150 },
];

/**
 * Add a measurement for the selected member. Weight is the only required number; every other field is
 * optional. Number fields open the numeric keypad (inputMode decimal). The date starts on today.
 */
export function MeasurementForm({ memberId, today }: { memberId: string; today: string }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [date, setDate] = useState(today);
  const [vals, setVals] = useState<Record<FieldKey, string>>({ weightKg: "", bodyFatPct: "", chestCm: "", waistCm: "", hipCm: "", armCm: "", thighCm: "" });
  const [note, setNote] = useState("");
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setProblem(null);
    const found: Record<string, string> = {};
    const body: Record<string, unknown> = { measuredOn: date, note: note.trim() || null };
    if (!date || date > today) found.measuredOn = t("gx.bm.errDate");
    for (const f of FIELDS) {
      const n = parseNumberInput(vals[f.key]);
      if (n === null) {
        if (f.key === "weightKg") found.weightKg = t("gx.bm.errWeight");
        continue;
      }
      if (Number.isNaN(n) || n < f.min || n > f.max) found[f.key] = f.key === "weightKg" ? t("gx.bm.errWeight") : t("gx.bm.errNumber");
      else body[f.key] = n;
    }
    if (note.length > 280) found.note = t("gx.bm.errNote");
    setErrs(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    const res = await recordMeasurementAction(memberId, body);
    setBusy(false);
    if (!res.ok) {
      setProblem(t("gx.bm.failed"));
      return;
    }
    toast(t("gx.bm.saved"));
    setVals({ weightKg: "", bodyFatPct: "", chestCm: "", waistCm: "", hipCm: "", armCm: "", thighCm: "" });
    setNote("");
    router.refresh();
  }

  const field = (f: (typeof FIELDS)[number]) => (
    <div className="field" key={f.key}>
      <label className="field-label" htmlFor={`bm-${f.key}`}>{t(f.label)}</label>
      <TextInput
        id={`bm-${f.key}`}
        name={f.key}
        inputMode="decimal"
        autoComplete="off"
        value={vals[f.key]}
        onChange={(e) => setVals((cur) => ({ ...cur, [f.key]: e.target.value }))}
        aria-invalid={errs[f.key] ? true : undefined}
        aria-describedby={errs[f.key] ? `bm-${f.key}-err` : undefined}
      />
      {errs[f.key] && <p id={`bm-${f.key}-err`} className="field-error">{errs[f.key]}</p>}
    </div>
  );

  return (
    <form className={s.form} onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate aria-label={t("gx.bm.add")} data-testid="measurement-form">
      {problem && <p className="msg-error" role="alert">{problem}</p>}
      <div className={s.formGrid}>
        <div className="field">
          <label className="field-label" htmlFor="bm-date">{t("gx.bm.date")}</label>
          <DateInput id="bm-date" value={date} max={today} onChange={(e) => setDate(e.target.value)} aria-invalid={errs.measuredOn ? true : undefined} />
          {errs.measuredOn && <p className="field-error">{errs.measuredOn}</p>}
        </div>
        {field(FIELDS[0]!)}
        {field(FIELDS[1]!)}
      </div>
      <details className={s.more}>
        <summary className={s.summary}>{t("gx.bm.more")}</summary>
        <div className={s.formGrid}>{FIELDS.slice(2).map(field)}</div>
      </details>
      <div className="field">
        <label className="field-label" htmlFor="bm-note">{t("gx.bm.note")}</label>
        <TextInput id="bm-note" value={note} onChange={(e) => setNote(e.target.value)} autoComplete="off" aria-invalid={errs.note ? true : undefined} />
        {errs.note && <p className="field-error">{errs.note}</p>}
      </div>
      <p className="field-hint">{t("gx.bm.sameDay")}</p>
      <div className="actions"><Button type="submit" loading={busy}>{t("gx.bm.save")}</Button></div>
    </form>
  );
}
