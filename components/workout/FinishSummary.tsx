"use client";
import { useEffect, useRef } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n";
import { formatBestValue, isBestMetric } from "@/lib/workouts/live/format";
import { formatClock, type Totals } from "@/lib/workouts/live/model";
import s from "./Workout.module.css";

export type BestRow = { exercise: string; metric: string; value: number; previous: number | null };

/**
 * What the member did, in calm numbers, and any new bests the engine reported. A new best is a
 * quiet highlighted row with a star glyph: no confetti, no motion.
 */
export function FinishSummary({
  totals,
  elapsedSeconds,
  bests,
  bestsState,
  backHref,
}: {
  totals: Totals;
  elapsedSeconds: number;
  bests: BestRow[];
  /** "checking" while sets are still syncing, "waiting" when offline with sets queued, else "ready". */
  bestsState: "ready" | "checking" | "waiting";
  backHref: string;
}) {
  const { t } = useI18n();
  const head = useRef<HTMLHeadingElement>(null);
  useEffect(() => head.current?.focus(), []);
  const stats: { label: string; value: string }[] = [
    { label: t("lw.sum.sets"), value: String(totals.setsDone) },
    { label: t("lw.sum.exercises"), value: String(totals.exercises) },
    { label: t("lw.sum.time"), value: formatClock(elapsedSeconds) },
  ];
  if (totals.volumeKg > 0) stats.splice(2, 0, { label: t("lw.sum.volume"), value: t("lw.sum.kg", { n: totals.volumeKg }) });
  else if (totals.reps > 0) stats.splice(2, 0, { label: t("lw.sum.reps"), value: String(totals.reps) });
  if (totals.meters > 0) stats.push({ label: t("lw.sum.distance"), value: t("lw.sum.metres", { n: totals.meters }) });

  return (
    <div className={s.summary} data-testid="finish-summary">
      <div>
        <h1 ref={head} tabIndex={-1} className={s.summaryTitle}>{t("lw.sum.title")}</h1>
        <p className="muted">{t("lw.sum.subtitle")}</p>
      </div>
      <dl className={s.stats}>
        {stats.map((x) => (
          <div key={x.label} className={s.stat}>
            <dt className={s.statLabel}>{x.label}</dt>
            <dd className={s.statValue} style={{ margin: 0 }}>{x.value}</dd>
          </div>
        ))}
      </dl>
      <section aria-labelledby="lw-bests-h" className="stack">
        <h2 id="lw-bests-h" className="card-title">{t("lw.sum.bests")}</h2>
        {bests.length > 0 ? (
          <ul className={s.bests}>
            {bests.map((b) => (
              <li key={`${b.exercise}-${b.metric}`} className={s.best}>
                <span className={s.bestStar} aria-hidden="true">★</span>
                <span className={s.bestText}>
                  <span className={s.bestName}>{t("lw.sum.newBest")}: {b.exercise}</span>
                  <span>
                    {isBestMetric(b.metric) ? t(`we.best.${b.metric}` as MessageKey) : b.metric}: {formatBestValue(b.metric, b.value, t)}
                    {b.previous !== null && <span className="muted"> ({t("lw.sum.was", { previous: formatBestValue(b.metric, b.previous, t) })})</span>}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted" role="status">
            {bestsState === "checking" ? t("lw.sum.bests.checking") : bestsState === "waiting" ? t("lw.sum.bests.waiting") : t("lw.sum.bests.none")}
          </p>
        )}
      </section>
      <div className="actions">
        <ButtonLink href={backHref} size="lg">{t("lw.sum.done")}</ButtonLink>
      </div>
    </div>
  );
}
