import s from "@/components/body-measurements/body.module.css";
import { muscleLabel } from "@/lib/gym-extras/view";
import type { MessageKey } from "@/lib/i18n";

export type MuscleBarRow = { muscle: string; sets: number; volumeKg: number; setsPerWeek: number };

/**
 * A compact horizontal bar list: one row per muscle with its set count, bars scaled to the busiest muscle.
 * `detail` adds sets per week and weight lifted under each bar (the full page). The list is real text, so
 * it needs no chart table for screen readers.
 */
export function MuscleBars({
  rows,
  t,
  detail,
  weeks,
}: {
  rows: MuscleBarRow[];
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
  detail?: boolean;
  weeks: number;
}) {
  const max = Math.max(1, ...rows.map((r) => r.sets));
  return (
    <ul className={s.bars} data-testid="muscle-bars" aria-label={t("gx.mv.chartAria")}>
      {rows.map((r) => (
        <li key={r.muscle} className={s.bar} data-testid="muscle-row" data-muscle={r.muscle}>
          <div className={s.barHead}>
            <span className={s.barName}>{muscleLabel(t, r.muscle)}</span>
            <span className={s.barNum}>{t("gx.mv.sets", { n: r.sets })}</span>
          </div>
          <div className={s.track} role="img" aria-label={t("gx.mv.barAria", { muscle: muscleLabel(t, r.muscle), n: r.sets })}>
            <span className={s.fill} style={{ width: `${Math.round((100 * r.sets) / max)}%` }} />
          </div>
          {detail && (
            <span className={s.barSub}>
              {[weeks > 1 ? t("gx.mv.perWeek", { n: r.setsPerWeek }) : null, r.volumeKg > 0 ? t("gx.mv.volume", { n: Math.round(r.volumeKg) }) : null].filter(Boolean).join(" · ")}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
