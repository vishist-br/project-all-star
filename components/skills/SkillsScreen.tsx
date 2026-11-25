import Link from "next/link";
import { getMemberSkillProgress } from "@/lib/api/skills";
import { checkRole } from "@/lib/auth/guard";
import { ChildSwitcher } from "@/components/customer/ChildSwitcher";
import { NoMember } from "@/components/customer/NoMember";
import { Badge, Card, EmptyState, PageHeader, ProgressBar } from "@/components/ui";
import { formatDay } from "@/lib/customer/format";
import { getCustomerContext } from "@/lib/customer/server";
import { getT } from "@/lib/i18n/server";
import { currentLevelName, orderChecklists, ratingKey, swatchColor, type SkillProgress } from "@/lib/skills/view";
import { RatingChip } from "./RatingChip";
import s from "./skills.module.css";

/** Customer: every belt checklist with what the coach has signed off. Read only; the coach signs skills off. */
export async function SkillsScreen() {
  const { t, locale } = await getT();
  const ctx = await getCustomerContext();
  if (!ctx.selected) return <NoMember />;
  const { principal, db, selected } = ctx;
  checkRole(principal, "getMemberSkillProgress");
  const progress = (await getMemberSkillProgress(db, principal, selected.id, new URLSearchParams())) as unknown as SkillProgress;
  const lists = orderChecklists(progress);

  return (
    <div className={s.stack}>
      <Link href="/customer/progress" className={s.link}>
        <span aria-hidden="true">←</span>&nbsp;{t("bt.back")}
      </Link>
      <PageHeader title={t("bt.page.title")} subtitle={t("bt.page.subtitle")} />
      <ChildSwitcher members={ctx.children} selectedId={selected.id} />
      {lists.length === 0 ? (
        <EmptyState title={t("bt.empty.title")} text={t("bt.empty.body")} icon="◎" />
      ) : (
        lists.map((c) => {
          const level = currentLevelName(progress, c.sportId);
          return (
            <Card key={c.checklistId} as="section" className="skills-checklist">
              <details open={c.isNextLevel}>
                <summary className={s.sum}>
                  <span>
                    <span className={s.belt}>
                      <span className={s.swatch} style={{ background: swatchColor(c.levelColorHex) }} aria-hidden="true" />
                      {c.levelName ?? c.title}
                    </span>
                    <span className={s.count}>
                      {c.sportName}
                      {c.isNextLevel && level ? ` · ${t("bt.current", { level })}` : ""}
                    </span>
                  </span>
                  <span className={s.chips}>
                    {c.isNextLevel && <Badge tone="info">{t("bt.nextBadge")}</Badge>}
                    <Badge tone={c.complete ? "ok" : "neutral"}>{t("bt.count", { done: c.doneCount, total: c.totalCount })}</Badge>
                  </span>
                </summary>
                <ProgressBar value={c.percent} label={t("bt.bar", { level: c.levelName ?? c.title })} />
                {c.complete && <p className={s.done}>{t("sk.checklistDone")}</p>}
                <ul className={s.list}>
                  {c.items.map((i) => (
                    <li key={i.skillItemId} className={s.item} data-signed={i.signedOff}>
                      <div className={s.itemHead}>
                        <p className={s.title}>{i.title}</p>
                        {i.signedOff && i.rating !== null ? (
                          <RatingChip rating={i.rating} label={t(ratingKey(i.rating))} />
                        ) : (
                          <span className={s.todo}>{t("bt.item.todo")}</span>
                        )}
                      </div>
                      {i.description && <p className={s.meta}>{i.description}</p>}
                      {i.signedOff && i.signedOffAt && (
                        <p className={s.meta}>
                          {t("bt.item.on", { date: formatDay(i.signedOffAt.slice(0, 10), locale) })}
                          {i.signedOffByName ? ` · ${t("bt.item.by", { name: i.signedOffByName })}` : ""}
                        </p>
                      )}
                      {i.note && <p className={s.note}>{i.note}</p>}
                    </li>
                  ))}
                </ul>
              </details>
            </Card>
          );
        })
      )}
    </div>
  );
}
