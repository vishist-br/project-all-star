import { ProgressRing } from "@/components/charts";
import { Badge, ProgressBar, StatGrid, StatTile } from "@/components/ui";
import type { ProgressCardDto } from "@/lib/api/progress-card";
import { formatDay } from "@/lib/customer/format";
import { getT } from "@/lib/i18n/server";
import { cheerFor } from "@/lib/progress-card/rules";
import s from "./progress-card.module.css";

/**
 * The weekly progress card itself: attendance this week, level or belt, goals, streak and the coach's
 * note, in positive framing. Used on the family's own page and on the public tokenised page, so it
 * only ever renders what ProgressCardDto holds (first name, no photo, no surname).
 */
export async function CardView({ card }: { card: ProgressCardDto }) {
  const { t, locale } = await getT();
  const a = card.attendance;
  const cheer = cheerFor(a.attended, a.held, card.streak.currentDays);
  return (
    <article className={s.card} aria-label={t("pc.hello", { name: card.firstName })} data-testid="progress-card">
      <header className={s.head}>
        <p className={s.biz}>{card.tenantName}</p>
        <h1 className={s.title} data-testid="card-title">{t("pc.hello", { name: card.firstName })}</h1>
        <p className={s.meta}>{t("pc.weekOf", { from: formatDay(card.weekStart, locale), to: formatDay(card.weekEnd, locale) })}</p>
      </header>

      <p className={s.cheer} data-testid="card-cheer">{t(`pc.cheer.${cheer}` as const)}</p>

      <section className={s.block} aria-label={t("pc.attendance.title")}>
        <h2>{t("pc.attendance.title")}</h2>
        {a.held === 0 ? (
          <p className={s.meta}>{t("pc.attendance.none")}</p>
        ) : (
          <StatGrid>
            <StatTile label={t("pc.attendance.title")} value={t("pc.attendance.line", { attended: a.attended, held: a.held })} />
            {a.percent !== null && <StatTile label={t("pc.attendance.percent", { n: Math.round(a.percent) })} value={`${Math.round(a.percent)}%`} />}
          </StatGrid>
        )}
        {a.excused > 0 && <p className={s.meta}>{t("pc.attendance.excused", { n: a.excused })}</p>}
      </section>

      <section className={s.block} aria-label={t("pc.level.title")}>
        <h2>{t("pc.level.title")}</h2>
        {card.level ? (
          <div className={s.levelRow}>
            <div className={s.ring}>
              <ProgressRing
                value={card.level.progressPercent}
                label={card.level.name}
                centerLabel={card.level.progressPercent === null ? "–" : `${Math.round(card.level.progressPercent)}%`}
                ariaLabel={t("pc.level.ring")}
                valueLabel={t("pc.level.value")}
                maxLabel={t("pc.level.max")}
              />
            </div>
            <div className={s.grow}>
              <p className={s.big} data-testid="card-level">{card.level.name}</p>
              <p className={s.meta}>{card.level.nextName ? t("pc.level.next", { name: card.level.nextName }) : t("pc.level.top")}</p>
            </div>
          </div>
        ) : (
          <p className={s.meta}>{t("pc.level.none")}</p>
        )}
      </section>

      <section className={s.block} aria-label={t("pc.goals.title")}>
        <h2>{t("pc.goals.title")}</h2>
        {card.goals.length === 0 ? (
          <p className={s.meta}>{t("pc.goals.none")}</p>
        ) : (
          <ul className={s.goals}>
            {card.goals.map((g, i) => (
              <li key={i} className={s.goal} data-testid="card-goal">
                <div className={s.goalHead}>
                  <p className={s.goalTitle}>{g.title}</p>
                  {g.achieved && <Badge tone="ok">{t("pc.goal.achieved")}</Badge>}
                </div>
                <ProgressBar value={g.progressPercent} label={t("pc.goal.bar", { title: g.title })} />
                <p className={s.meta}>{t("pc.goal.percent", { n: Math.round(g.progressPercent) })}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={s.block} aria-label={t("pc.streak.title")}>
        <h2>{t("pc.streak.title")}</h2>
        <p className={s.big} data-testid="card-streak">{t("pc.streak.value", { n: card.streak.currentDays })}</p>
        <p className={s.meta}>{t("pc.streak.best", { n: card.streak.longestDays })}</p>
      </section>

      <section className={s.block} aria-label={t("pc.note.title")}>
        <h2>{t("pc.note.title")}</h2>
        {card.coachNote ? <p className={s.note} data-testid="card-note">{card.coachNote}</p> : <p className={s.meta}>{t("pc.note.none")}</p>}
      </section>
    </article>
  );
}
