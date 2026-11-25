import type { ReactNode } from "react";
import s from "./Workout.module.css";

/**
 * Visual bracket around the exercises of a superset: a coloured bar on the leading edge, a tag
 * ("Superset A") and a short meta line ("3 rounds, rest 60 s after both"). `tools` holds the
 * builder's buttons (move, ungroup); the live screen leaves it empty. Colour is never the only
 * signal: the tag text names the group and the region has an accessible name.
 */
export function SupersetBracket({
  tag,
  meta,
  regionLabel,
  tools,
  children,
}: {
  tag: string;
  meta?: string;
  regionLabel: string;
  tools?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={s.bracket} aria-label={regionLabel} data-testid="superset">
      <div className={s.bracketHead}>
        <span className={s.tag}>{tag}</span>
        {meta && <span className={s.bracketMeta}>{meta}</span>}
        {tools && <span className={s.bracketTools}>{tools}</span>}
      </div>
      <div className={s.bracketBody}>{children}</div>
    </section>
  );
}
