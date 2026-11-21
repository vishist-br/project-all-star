import type { ReactNode } from "react";
import { Button } from "./Button";

/** Friendly "nothing here yet" with a next step. Decorative icon is a glyph. */
export function EmptyState({ title, text, action, icon = "○" }: { title: string; text?: string; action?: ReactNode; icon?: string }) {
  return (
    <div className="state">
      <span className="state-icon" aria-hidden="true">{icon}</span>
      <h2 className="state-title">{title}</h2>
      {text && <p className="muted">{text}</p>}
      {action}
    </div>
  );
}

/** Error with an optional retry. All text comes from the caller (translated). */
export function ErrorState({ title, message, retryLabel, onRetry }: { title: string; message?: string; retryLabel?: string; onRetry?: () => void }) {
  return (
    <div className="state state-error" role="alert">
      <span className="state-icon" aria-hidden="true">!</span>
      <h2 className="state-title">{title}</h2>
      {message && <p className="muted">{message}</p>}
      {onRetry && retryLabel && (
        <Button variant="secondary" onClick={onRetry}>{retryLabel}</Button>
      )}
    </div>
  );
}
