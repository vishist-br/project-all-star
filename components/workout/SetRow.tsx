"use client";
import { useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n";
import { SET_TYPES, type MetricType, type RowProblem, type RowState, type SetType } from "@/lib/workouts/live/model";
import { NumberStepper } from "./NumberStepper";
import { SegmentedControl } from "./SegmentedControl";
import s from "./Workout.module.css";

export const fieldId = (itemKey: string, setNumber: number, field: string) => `lw-${itemKey.replace(/[^\w-]/g, "-")}-${setNumber}-${field}`;

/** Column headers of the set grid for a metric type (same grid as the rows). */
export function SetGridHead({ metric, round }: { metric: MetricType; round?: boolean }) {
  const { t } = useI18n();
  const first = round ? t("lw.col.round") : t("lw.col.set");
  const cols: Record<MetricType, string[]> = {
    WEIGHT_REPS: [first, t("lw.col.kg"), t("lw.col.reps"), t("lw.col.done")],
    REPS: [first, t("lw.col.reps"), t("lw.col.done")],
    TIME: [first, t("lw.col.seconds"), t("lw.col.done")],
    DISTANCE_TIME: [first, t("lw.col.metres"), t("lw.col.time"), t("lw.col.done")],
    SCORE: [first, t("lw.col.made"), t("lw.col.outOf"), t("lw.col.done")],
    CHECKLIST: [],
  };
  if (metric === "CHECKLIST") return null;
  return (
    <div className={`${s.gridHead} ${s[`cols_${metric}`]}`} aria-hidden="true">
      {cols[metric].map((c, i) => (
        <span key={i}>{i === cols[metric].length - 1 ? "✓" : c}</span>
      ))}
    </div>
  );
}

/**
 * One set of one exercise. The fields depend on the metric type; the tick logs the set. Big numeric
 * inputs, one tap to tick. Used by the live workout; it knows nothing about the queue.
 */
export function SetRow({
  metric,
  itemKey,
  exerciseName,
  row,
  problem,
  onChange,
  onTick,
  onBlurRow,
}: {
  metric: MetricType;
  itemKey: string;
  exerciseName: string;
  row: RowState;
  problem: RowProblem | null;
  onChange: (patch: Partial<RowState>) => void;
  onTick: () => void;
  onBlurRow: () => void;
}) {
  const { t } = useI18n();
  const [pickType, setPickType] = useState(false);
  const n = row.setNumber;
  const id = (f: string) => fieldId(itemKey, n, f);
  const msgId = `${id("msg")}`;
  const label = (key: MessageKey) => t("lw.row.field", { field: t(key), n, name: exerciseName });
  const typeLabel = t(`lw.type.${row.setType}` as MessageKey);
  const invalid = problem !== null;

  const field = (key: "weight" | "reps" | "seconds" | "meters" | "made" | "outOf", col: MessageKey, opts: { decimal?: boolean; buttons?: boolean; step?: number } = {}) => (
    <NumberStepper
      id={id(key)}
      label={label(col)}
      value={row[key]}
      onChange={(v) => onChange({ [key]: v })}
      decimal={opts.decimal}
      step={opts.step}
      showButtons={opts.buttons}
      minusLabel={t("lw.row.minus", { field: t(col), n })}
      plusLabel={t("lw.row.plus", { field: t(col), n })}
      invalid={invalid}
      describedBy={invalid ? msgId : undefined}
      onEnter={onTick}
    />
  );

  const tick = (
    <button
      type="button"
      id={id("tick")}
      className={s.tick}
      aria-pressed={row.done}
      aria-label={row.done ? t("lw.row.ticked", { n, name: exerciseName }) : t("lw.row.tick", { n, name: exerciseName })}
      onClick={row.done ? undefined : onTick}
    >
      <span aria-hidden="true">✓</span>
    </button>
  );

  return (
    <div className={s.setBlock} data-testid="set-row" data-done={row.done} onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && onBlurRow()}>
      <div className={`${s.setRow} ${s[`cols_${metric}`]}`} data-done={row.done}>
        {metric === "WEIGHT_REPS" ? (
          <button
            type="button"
            className={s.typeChip}
            data-type={row.setType}
            aria-expanded={pickType}
            aria-label={t("lw.type.change", { n, type: typeLabel })}
            onClick={() => setPickType((v) => !v)}
          >
            <span className={s.chipNum} aria-hidden="true">{n}</span>
            <span aria-hidden="true">{typeLabel}</span>
          </button>
        ) : (
          <span className={s.setNum} aria-hidden="true" style={{ textAlign: "center" }}>{n}</span>
        )}
        {metric === "WEIGHT_REPS" && (
          <>
            {field("weight", "lw.col.kg", { decimal: true })}
            {field("reps", "lw.col.reps")}
          </>
        )}
        {metric === "REPS" && field("reps", "lw.col.reps")}
        {metric === "TIME" && field("seconds", "lw.col.seconds", { buttons: true, step: 5 })}
        {metric === "DISTANCE_TIME" && (
          <>
            {field("meters", "lw.col.metres")}
            {field("seconds", "lw.col.time")}
          </>
        )}
        {metric === "SCORE" && (
          <>
            {field("made", "lw.col.made")}
            {field("outOf", "lw.col.outOf")}
          </>
        )}
        {tick}
      </div>
      {metric === "WEIGHT_REPS" && pickType && (
        <div className={s.typePick}>
          <SegmentedControl<SetType>
            label={t("lw.type.group")}
            value={row.setType}
            options={SET_TYPES.map((v) => ({ value: v, label: t(`lw.type.${v}` as MessageKey) }))}
            onChange={(v) => {
              onChange({ setType: v });
            }}
          />
        </div>
      )}
      {problem && (
        <p id={msgId} className={s.rowMsg} role="alert">
          {problem === "scoreOrder" ? t("lw.row.scoreOrder") : t("lw.row.needValue")}
        </p>
      )}
    </div>
  );
}
