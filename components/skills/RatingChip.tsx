import { RATINGS } from "@/lib/skills/view";
import s from "./skills.module.css";

/** Rating as text plus four pips, so it never relies on colour. `label` is the translated word ("Confident"). */
export function RatingChip({ rating, label, prefix }: { rating: number; label: string; prefix?: string }) {
  return (
    <span className={s.rating} data-rating={rating}>
      <span className={s.pips} aria-hidden="true">
        {RATINGS.map((n) => (
          <span key={n} className={`${s.pip}${n <= rating ? ` ${s.pipOn}` : ""}`} />
        ))}
      </span>
      {prefix ? `${prefix}: ` : ""}
      {label}
    </span>
  );
}
