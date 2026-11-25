import Link from "next/link";
import { Card, ProgressBar } from "@/components/ui";
import { getT } from "@/lib/i18n/server";
import { ratingKey, swatchColor, type BeltCardModel } from "@/lib/skills/view";
import { RatingChip } from "./RatingChip";
import s from "./skills.module.css";

/** "Next belt: Yellow, 6 of 9 skills" with a progress bar, what is left and the rating chips. */
export async function BeltCard({ model, href }: { model: BeltCardModel; href: string }) {
  const { t } = await getT();
  return (
    <Card title={t("bt.card.title")} className="belt-card">
      <div className={s.stack} data-testid="belt-card">
        <p className={s.belt}>
          <span className={s.swatch} style={{ background: swatchColor(model.checklist.levelColorHex) }} aria-hidden="true" />
          <span data-testid="belt-next">{t("bt.next", { level: model.levelName })}</span>
        </p>
        <p className={s.count} data-testid="belt-count">{t("bt.count", { done: model.done, total: model.total })}</p>
        <ProgressBar value={model.percent} label={t("bt.bar", { level: model.levelName })} />
        {model.complete ? (
          <p className={s.done}>{t("sk.checklistDone")}</p>
        ) : (
          model.left.length > 0 && (
            <p className={s.left} data-testid="belt-left">
              <strong>{t("bt.left")}</strong>
              {model.left.join(", ")}
              {model.moreLeft > 0 ? ` ${t("bt.more", { n: model.moreLeft })}` : ""}
            </p>
          )
        )}
        {model.rated.length > 0 && (
          <ul className={s.chips} aria-label={t("bt.ratings")}>
            {model.rated.map((r) => (
              <li key={r.title}>
                <RatingChip rating={r.rating} label={t(ratingKey(r.rating))} prefix={r.title} />
              </li>
            ))}
          </ul>
        )}
        <Link className={s.link} href={href} data-testid="skills-link">{t("bt.all")}</Link>
      </div>
    </Card>
  );
}
