"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { clearSkillSignOffAction, signOffSkillAction } from "@/app/[role]/_actions/skills";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { useI18n } from "@/lib/i18n/client";
import { RATINGS, ratingKey, swatchColor, type Checklist } from "@/lib/skills/view";
import s from "./skills.module.css";

/**
 * Skills of one member for a coach or owner: tap a rating (1 to 4) to sign a skill off or change it,
 * "Clear" takes it back. Read-only viewers get the list without the controls.
 */
export function SkillsPanel({ memberId, checklists, canManage }: { memberId: string; checklists: Checklist[]; canManage: boolean }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  function sign(item: { skillItemId: string; title: string }, rating: number) {
    setBusy(item.skillItemId);
    start(async () => {
      const res = await signOffSkillAction(memberId, item.skillItemId, rating);
      setBusy(null);
      if (res.ok) {
        toast(t("bt.coach.saved", { skill: item.title }));
        router.refresh();
      } else toast(t("bt.coach.failed"), "danger");
    });
  }
  function clear(item: { skillItemId: string; title: string }) {
    setBusy(item.skillItemId);
    start(async () => {
      const res = await clearSkillSignOffAction(memberId, item.skillItemId);
      setBusy(null);
      if (res.ok) {
        toast(t("bt.coach.cleared", { skill: item.title }));
        router.refresh();
      } else toast(t("bt.coach.failed"), "danger");
    });
  }

  return (
    <Card title={t("bt.coach.title")}>
      <div className={s.stack} data-testid="skills-section">
        <p className={s.count}>{canManage ? t("bt.coach.subtitle") : t("bt.coach.readOnly")}</p>
        {checklists.length === 0 ? (
          <EmptyState title={t("bt.coach.empty.title")} text={t("bt.coach.empty.body")} icon="◎" />
        ) : (
          checklists.map((c) => (
            <details key={c.checklistId} open={c.isNextLevel} className={s.stack}>
              <summary className={s.sum}>
                <span className={s.belt}>
                  <span className={s.swatch} style={{ background: swatchColor(c.levelColorHex) }} aria-hidden="true" />
                  {c.levelName ?? c.title}
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
                  <li key={i.skillItemId} className={s.item} data-testid="skill-item" data-signed={i.signedOff}>
                    <div className={s.itemHead}>
                      <p className={s.title}>{i.title}</p>
                      {i.signedOff && i.rating !== null ? (
                        <Badge tone="ok">{t(ratingKey(i.rating))}</Badge>
                      ) : (
                        <span className={s.todo}>{t("bt.item.todo")}</span>
                      )}
                    </div>
                    {canManage && (
                      <>
                        <div className={s.rate} role="group" aria-label={t("bt.coach.rate", { skill: i.title })}>
                          {RATINGS.map((r) => (
                            <button
                              key={r}
                              type="button"
                              className={s.rateBtn}
                              aria-pressed={i.rating === r}
                              disabled={pending && busy === i.skillItemId}
                              onClick={() => sign(i, r)}
                              data-testid={`rate-${r}`}
                            >
                              <span className={s.rateNo}>{r}</span>
                              <span>{t(ratingKey(r))}</span>
                            </button>
                          ))}
                        </div>
                        {i.signedOff && (
                          <div>
                            <Button variant="ghost" onClick={() => clear(i)} disabled={pending && busy === i.skillItemId} aria-label={t("bt.coach.clearFor", { skill: i.title })}>
                              {t("bt.coach.clear")}
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          ))
        )}
        {canManage && checklists.length > 0 && <p className={s.note}>{t("bt.gap")}</p>}
      </div>
    </Card>
  );
}
