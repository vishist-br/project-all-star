import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { formatDay } from "@/lib/customer/format";
import type { MessageKey } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { bestKey, formatBest, setsText, type AssignmentView, type ItemView } from "@/lib/send/results";
import { firstName } from "@/lib/send/view";
import { ReplyWithNote } from "./ReplyWithNote";
import s from "./send.module.css";

const BADGE_TONE = { completed: "ok", inProgress: "info", notStarted: "neutral" } as const;

/**
 * What one member logged for one plan: badge, sets done, each day as blocks (a superset is one block),
 * new bests, the member's note and the coach actions. Visibility only: no ranking, no comparison.
 */
export async function AssignmentResults({ view, role, planId, compact = false }: { view: AssignmentView; role: string; planId: string; compact?: boolean }) {
  const { t, locale } = await getT();
  const name = firstName(view.memberName);
  const bests = view.days.flatMap((d) => d.blocks.flatMap((b) => b.items.flatMap((i) => i.newBests.map((nb) => ({ ...nb, exercise: i.name })))));
  const days = compact ? view.days.slice(0, 1) : view.days;
  return (
    <Card as="article" className={s.stack}>
      <div className={s.resHead}>
        <h2 className={s.resName}>{view.memberName}</h2>
        <span className={s.rowGap}>
          <Badge tone={BADGE_TONE[view.badge]}>{t(`rs.badge.${view.badge}` as MessageKey)}</Badge>
          {view.paused && <Badge tone="warn">{t("rs.badge.paused")}</Badge>}
          {view.ended && <Badge>{t("rs.badge.ended")}</Badge>}
        </span>
      </div>
      <p className={s.resMeta}>
        {[view.badge !== "notStarted" ? setsText(view, t) : null, view.daysLogged > 0 ? t("rs.days", { n: view.daysLogged }) : null].filter(Boolean).join(" · ")}
      </p>

      {view.badge === "notStarted" ? (
        <p className="muted">{t("rs.noLogs", { name })}</p>
      ) : (
        <>
          <h3 className={s.sectionHeading}>{t("rs.logged", { name })}</h3>
          {days.map((d) => (
            <div key={d.date} className={s.day}>
              <p className={s.dayTitle}>{formatDay(d.date, locale)}</p>
              {d.blocks.map((b, bi) => (
                <div key={bi} className={`${s.block}${b.type === "superset" ? ` ${s.superset}` : ""}`} role={b.type === "superset" ? "group" : undefined} aria-label={b.type === "superset" ? t("rs.block.superset", { label: b.label ?? "" }) : undefined}>
                  {b.type === "superset" && (
                    <p className={s.blockHead}>
                      {[t("rs.block.superset", { label: b.label ?? "" }), b.rounds ? t("rs.block.rounds", { rounds: b.rounds }) : null].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  {b.items.map((i) => <Exercise key={i.logId} item={i} t={t} />)}
                </div>
              ))}
            </div>
          ))}
        </>
      )}

      {bests.length > 0 && (
        <div className={s.bestCard} role="status">
          <strong>{t(bests.length === 1 ? "rs.newBest.one" : "rs.newBest.other", { n: bests.length })}</strong>
          {bests.map((b, i) => (
            <p key={i}>
              {b.exercise}: {t("rs.newBest.line", { metric: t(bestKey(b.metric)), value: formatBest(b.metric, b.value) })}
              {b.previous !== null && ` (${t("rs.newBest.before", { previous: formatBest(b.metric, b.previous) })})`}
            </p>
          ))}
          <p>{t("rs.newBest.cheer")}</p>
        </div>
      )}

      {view.notes.map((n) => (
        <div key={n} className={s.memberNote}>
          <span className={s.noteLabel}>{t("rs.memberNote", { name })}</span>
          <p>{n}</p>
        </div>
      ))}

      <div className={s.rowGap}>
        {!view.ended && <ReplyWithNote assignmentId={view.assignmentId} memberName={view.memberName} />}
        <ButtonLink variant="secondary" href={`/${role}/plans/${planId}`}>{t("rs.adjust")}</ButtonLink>
        {compact && <ButtonLink variant="ghost" href={`/${role}/plans/${planId}/results?memberId=${view.memberId}`}>{t("rs.member.seeAll")}</ButtonLink>}
      </div>
    </Card>
  );
}

function Exercise({ item, t }: { item: ItemView; t: (k: MessageKey, p?: Record<string, string | number>) => string }) {
  return (
    <div className={s.exercise}>
      <p className={s.exName}>
        {item.name} {item.skipped && <Badge tone="neutral">{t("rs.exerciseSkipped")}</Badge>}
      </p>
      {item.sets.length > 0 && (
        <ul className={s.setList} aria-label={item.name}>
          {item.sets.map((x) => (
            <li key={x.key} className={s.setRow}>
              <span className={s.setLabel}>{x.typeLabel ? `${x.label} · ${x.typeLabel}` : x.label}</span>
              <span className={s.setValue}>{x.value}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
