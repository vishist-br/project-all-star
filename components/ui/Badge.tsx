import type { ReactNode } from "react";

export type Tone = "neutral" | "ok" | "warn" | "danger" | "info";

/** Status chip. Colour is never the only signal: always put the status in the text. */
export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

/** Linear progress. Pass a label for screen readers (for example "Attendance"). */
export function ProgressBar({ value, max = 100, label }: { value: number | null; max?: number; label: string }) {
  const pct = value === null ? 0 : Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value ?? undefined}>
      <span className="progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Initials only, never a photo. Decorative: the name is shown next to it. */
export function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => Array.from(p)[0]!.toUpperCase())
    .join("");
  return <span className="avatar" aria-hidden="true">{initials || "?"}</span>;
}

/** Small dot for "something new". Pair it with text for screen readers. */
export function UnreadDot({ label }: { label: string }) {
  return <span className="unread-dot" role="img" aria-label={label} />;
}
