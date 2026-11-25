"use client";
import type { FocusEvent, KeyboardEvent } from "react";
import { parseNum } from "@/lib/workouts/live/model";
import s from "./Workout.module.css";

/**
 * A big numeric text field for logging: numeric keypad (`inputMode`), selects its text on focus so a
 * typed number replaces the pre-filled one, Enter moves on, and optional minus and plus buttons
 * (44px+) for small steps. The value is a string so "42." and "" are valid while typing.
 */
export function NumberStepper({
  id,
  label,
  value,
  onChange,
  decimal = false,
  step = 1,
  min = 0,
  max = 100000,
  showButtons = false,
  minusLabel,
  plusLabel,
  invalid,
  describedBy,
  onEnter,
  onBlur,
}: {
  id: string;
  /** Accessible name (visible column headers are not enough on their own). */
  label: string;
  value: string;
  onChange: (value: string) => void;
  decimal?: boolean;
  step?: number;
  min?: number;
  max?: number;
  showButtons?: boolean;
  minusLabel?: string;
  plusLabel?: string;
  invalid?: boolean;
  describedBy?: string;
  onEnter?: () => void;
  onBlur?: () => void;
}) {
  const current = parseNum(value);
  const bump = (dir: 1 | -1) => {
    const base = current ?? 0;
    const next = Math.min(max, Math.max(min, Math.round((base + dir * step) * 100) / 100));
    onChange(String(next));
  };
  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      onEnter?.();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      bump(1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      bump(-1);
    }
  }
  const clean = (raw: string) => {
    // Keep digits and one decimal point; a comma counts as the point (many Indian keyboards show it).
    let v = raw.replace(",", ".").replace(decimal ? /[^\d.]/g : /\D/g, "");
    if (decimal) {
      const i = v.indexOf(".");
      if (i >= 0) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/\./g, "").slice(0, 2);
    }
    return v.slice(0, 7);
  };
  return (
    <div className={s.numField}>
      {showButtons && (
        <button type="button" className={s.stepBtn} aria-label={minusLabel} onClick={() => bump(-1)} disabled={current !== null && current <= min}>
          −
        </button>
      )}
      <input
        id={id}
        className={s.num}
        type="text"
        inputMode={decimal ? "decimal" : "numeric"}
        pattern={decimal ? "[0-9]*[.,]?[0-9]*" : "[0-9]*"}
        enterKeyHint="next"
        autoComplete="off"
        value={value}
        aria-label={label}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        onChange={(e) => onChange(clean(e.target.value))}
        onFocus={(e: FocusEvent<HTMLInputElement>) => e.target.select()}
        onKeyDown={onKey}
        onBlur={onBlur}
      />
      {showButtons && (
        <button type="button" className={s.stepBtn} aria-label={plusLabel} onClick={() => bump(1)} disabled={current !== null && current >= max}>
          +
        </button>
      )}
    </div>
  );
}
