"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useI18n } from "@/lib/i18n/client";
import { ADD_SECONDS, isRestOver, remainingSeconds, restPercent, type Rest } from "@/lib/workouts/live/rest";
import { formatClock } from "@/lib/workouts/live/model";
import s from "./Workout.module.css";

/** A clock that ticks while `active`; returns Date.now() (0 before the first tick so the server and first client render agree). */
export function useNow(active: boolean, everyMs = 250): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!active) return;
    // First tick right away, so the countdown never shows a stale second.
    const first = window.setTimeout(() => setNow(Date.now()), 0);
    const id = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [active, everyMs]);
  return now;
}

const AUTO_DISMISS_MS = 6000;

/**
 * The single rest timer of the live workout: a big countdown, skip and +15 s. Visual ticks are
 * hidden from assistive tech; only the start and the end are announced (one polite status line).
 * No motion beyond a width change, which is switched off under prefers-reduced-motion.
 */
export function RestTimer({ rest, onSkip, onAdd, onDismiss }: { rest: Rest; onSkip: () => void; onAdd: () => void; onDismiss: () => void }) {
  const { t } = useI18n();
  const now = useNow(true);
  const over = now > 0 && isRestOver(rest, now);
  const left = now === 0 ? rest.totalSeconds : remainingSeconds(rest, now);
  // The status line starts empty and gets its text a moment after mounting, so screen readers announce
  // the start; it changes once more when the rest is over. Ticks of the countdown are never announced.
  const [armed, setArmed] = useState(false);
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  });
  useEffect(() => {
    const id = window.setTimeout(() => setArmed(true), 60);
    return () => window.clearTimeout(id);
  }, []);
  useEffect(() => {
    if (!over) return;
    const id = window.setTimeout(() => dismissRef.current(), AUTO_DISMISS_MS);
    return () => window.clearTimeout(id);
  }, [over]);
  const announce = !armed ? "" : over ? t("lw.rest.over") : t("lw.rest.started", { s: rest.totalSeconds });

  return (
    <div className={s.dock}>
      <div className={s.rest} data-testid="rest-timer" role="timer" aria-label={t("lw.rest.timer")}>
        <div className={s.restTop}>
          <span className={s.restTitle}>{t("lw.rest.title")}</span>
          {over ? (
            <span className={s.restOver}>{t("lw.rest.overShort")}</span>
          ) : (
            <span className={s.restTime} aria-hidden="true" data-testid="rest-time">
              {formatClock(left)}
            </span>
          )}
        </div>
        <div className={s.restBar} aria-hidden="true">
          <span className={s.restFill} style={{ width: `${over ? 100 : restPercent(rest, now || rest.endsAt - rest.totalSeconds * 1000)}%` }} />
        </div>
        <div className={s.restBtns}>
          <Button variant="secondary" onClick={onSkip}>{over ? t("lw.card.doneBadge") : t("lw.rest.skip")}</Button>
          {!over && (
            <Button variant="secondary" onClick={onAdd} aria-label={t("lw.rest.addAria", { s: ADD_SECONDS })}>
              {t("lw.rest.add", { s: ADD_SECONDS })}
            </Button>
          )}
        </div>
        <p className="sr-only" role="status" aria-live="polite">{announce}</p>
      </div>
    </div>
  );
}
