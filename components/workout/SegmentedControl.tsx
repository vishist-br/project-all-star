"use client";
import { useRef, type KeyboardEvent } from "react";
import s from "./Workout.module.css";

export type SegmentOption<V extends string> = { value: V; label: string };

/**
 * One choice out of a few (set type, metric filter). A radio group: arrow keys move and select,
 * Tab enters and leaves once. Every option is at least 44px tall.
 */
export function SegmentedControl<V extends string>({
  label,
  options,
  value,
  onChange,
  id,
}: {
  label: string;
  options: readonly SegmentOption<V>[];
  value: V;
  onChange: (value: V) => void;
  id?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  function onKey(e: KeyboardEvent, index: number) {
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (dir === 0) return;
    e.preventDefault();
    const next = (index + dir + options.length) % options.length;
    onChange(options[next]!.value);
    refs.current[next]?.focus();
  }
  return (
    <div className={s.segCtl} role="radiogroup" aria-label={label} id={id}>
      {options.map((o, i) => {
        const checked = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            className={s.segOpt}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
