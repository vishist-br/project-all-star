"use client";
import { useId, useState } from "react";

/** Whole-number stepper with 44px buttons (sets, reps, duration, rest). */
export function NumberStepper({
  label,
  value: initial,
  min = 0,
  max = 999,
  step = 1,
  decreaseLabel,
  increaseLabel,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  decreaseLabel: string;
  increaseLabel: string;
  onChange?: (value: number) => void;
}) {
  const [value, setValue] = useState(initial);
  const id = useId();
  const set = (v: number) => {
    const next = Math.min(max, Math.max(min, v));
    setValue(next);
    onChange?.(next);
  };
  return (
    <div className="stepper" role="group" aria-labelledby={id}>
      <span id={id} className="field-label">{label}</span>
      <div className="stepper-row">
        <button type="button" className="icon-btn" aria-label={decreaseLabel} onClick={() => set(value - step)} disabled={value <= min}>−</button>
        <output aria-live="polite" className="stepper-value">{value}</output>
        <button type="button" className="icon-btn" aria-label={increaseLabel} onClick={() => set(value + step)} disabled={value >= max}>+</button>
      </div>
    </div>
  );
}
