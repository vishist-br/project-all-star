import { ProgressBar } from "@/components/ui/Badge";
import type { BeltLike, WorkoutLike } from "@/lib/classes/view";
import { workoutBlocks } from "@/lib/classes/view";
import type { MessageKey, Params } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import s from "./classes.module.css";

export type SummaryBodyData = {
  titleKey: string;
  bodyKey: string;
  params: Record<string, string>;
  status: "present" | "absent" | "excused";
  coachNote: string | null;
  homePractice: string | null;
  workout: WorkoutLike | null;
};

/**
 * The words of a class summary, in this order: title, line, coach note, what you did (or what we covered),
 * belt progress, practise at home. Shared by the member card, the member page and the public family page.
 * Titles come from message keys, never from English text. Only a first name is ever in the params.
 */
export async function SummaryBody({ data, belt, headingLevel = 2 }: { data: SummaryBodyData; belt?: BeltLike | null; headingLevel?: 1 | 2 | 3 }) {
  const { t } = await getT();
  const tt = (k: string, p?: Params) => t(k as MessageKey, p);
  const blocks = workoutBlocks(data.workout, t);
  const H = `h${headingLevel}` as "h1" | "h2" | "h3";
  return (
    <>
      <div>
        <H className={s.title}>{tt(data.titleKey, data.params)}</H>
        <p className={s.body}>{tt(data.bodyKey, data.params)}</p>
      </div>
      {data.coachNote && (
        <blockquote className={s.quote}>
          <p className={s.label}>{t("csm.coachNote")}</p>
          <p className={s.text}>{data.coachNote}</p>
        </blockquote>
      )}
      {blocks.length > 0 && (
        <div role="group" aria-label={data.status === "present" ? t("csm.whatYouDid") : t("csm.whatWeCovered")} style={{ display: "grid", gap: "var(--s2)" }}>
          <p className={s.label}>{data.status === "present" ? t("csm.whatYouDid") : t("csm.whatWeCovered")}</p>
          {blocks.map((b, i) => (
            <div key={i} className={b.superset ? s.superset : undefined} role={b.superset ? "group" : undefined} aria-label={b.heading ?? undefined}>
              {b.heading && <p className={s.blockHead}>{b.heading}</p>}
              <ul className={s.rows}>
                {b.rows.map((r) => (
                  <li key={r.id} className={s.row}>
                    <span className={s.rowName}>{r.name}</span>
                    {r.target && <span className={s.rowTarget}>{r.target}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {belt && (
        <div className={s.belt}>
          <p className={s.beltLine}>{t("csm.beltProgress", { level: belt.levelName, done: belt.doneCount, total: belt.totalCount })}</p>
          <ProgressBar value={belt.percent} label={t("csm.beltLabel", { level: belt.levelName })} />
        </div>
      )}
      {data.homePractice && (
        <div className={s.practise}>
          <p className={s.label}>{t("csm.practise")}</p>
          <p className={s.text}>{data.homePractice}</p>
        </div>
      )}
    </>
  );
}
