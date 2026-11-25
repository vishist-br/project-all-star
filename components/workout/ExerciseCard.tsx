"use client";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useI18n } from "@/lib/i18n/client";
import { formatLast, formatTargets } from "@/lib/workouts/live/format";
import { itemKeyOf, type LiveItem, type RowProblem, type RowState, type SavedSet } from "@/lib/workouts/live/model";
import { SetGridHead, SetRow, fieldId } from "./SetRow";
import s from "./Workout.module.css";

/** One exercise of the live workout: name, targets, last time, and one row per set (or per round in a superset). */
export function ExerciseCard({
  item,
  inSuperset,
  rows,
  last,
  problems,
  onChange,
  onTick,
  onBlurRow,
  onAddSet,
}: {
  item: LiveItem;
  inSuperset: boolean;
  rows: RowState[];
  last: SavedSet[];
  problems: Record<number, RowProblem | undefined>;
  onChange: (setNumber: number, patch: Partial<RowState>) => void;
  onTick: (setNumber: number) => void;
  onBlurRow: (setNumber: number) => void;
  onAddSet: () => void;
}) {
  const { t, locale } = useI18n();
  const key = itemKeyOf(item);
  const allDone = rows.length > 0 && rows.every((r) => r.done);
  const targets = formatTargets(item, inSuperset, t, locale);
  const lastText = formatLast(item.metricType, last, t);
  const headingId = `lw-h-${key.replace(/[^\w-]/g, "-")}`;
  const check = item.metricType === "CHECKLIST";
  const lastRating = check ? (last.find((x) => x.rating !== null)?.rating ?? null) : null;

  return (
    <article className={s.card} data-done={allDone} aria-labelledby={headingId} data-testid="exercise-card">
      <div className={s.cardHead}>
        <h3 id={headingId} className={s.name}>
          <Link href={`/customer/exercise/${item.exerciseId}?item=${item.planItemId}`}>
            {item.exerciseName}
            <span className="sr-only"> ({t("lw.card.details")})</span>
          </Link>
        </h3>
        {allDone && <Badge tone="ok">{t("lw.card.doneBadge")}</Badge>}
      </div>
      {targets.length > 0 && <p className={s.hint}>{t("lw.card.target", { value: targets.join(" · ") })}</p>}
      {lastText && !check && <p className={s.hint}>{t("lw.card.last", { value: lastText })}</p>}
      {item.notes && (
        <p className={s.note}>
          <span className="sr-only">{t("lw.card.coachNote")}: </span>
          {item.notes}
        </p>
      )}

      {check ? (
        <div className={s.check}>
          <p className={s.hint}>{lastRating !== null ? t("lw.check.rating", { n: lastRating }) : t("lw.check.noRating")}</p>
          <div className={s.checkRow}>
            <button
              type="button"
              id={fieldId(key, 1, "tick")}
              className={`${s.tick} ${s.tickWide}`}
              aria-pressed={rows[0]?.done === true}
              onClick={() => (rows[0]?.done ? undefined : onTick(1))}
            >
              <span>{rows[0]?.done ? t("lw.check.done") : t("lw.check.mark")}</span>
            </button>
          </div>
        </div>
      ) : (
        <div className={s.grid} role="group" aria-labelledby={headingId}>
          <SetGridHead metric={item.metricType} round={inSuperset} />
          {rows.map((r) => (
            <SetRow
              key={r.clientId}
              metric={item.metricType}
              itemKey={key}
              exerciseName={item.exerciseName}
              row={r}
              problem={problems[r.setNumber] ?? null}
              onChange={(patch) => onChange(r.setNumber, patch)}
              onTick={() => onTick(r.setNumber)}
              onBlurRow={() => onBlurRow(r.setNumber)}
            />
          ))}
        </div>
      )}
      {!inSuperset && !check && rows.length < 20 && (
        <Button variant="ghost" className={s.addSet} onClick={onAddSet} aria-label={t("lw.addSet.aria", { name: item.exerciseName })}>
          + {t("lw.addSet")}
        </Button>
      )}
    </article>
  );
}
