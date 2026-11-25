import { listPlanAssignments } from "@/lib/api/assignments";
import { listMemberUpdates } from "@/lib/api/member-updates";
import { getWorkoutPlan } from "@/lib/api/workout-plans";
import { ApiError } from "@/lib/auth/errors";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { MarkRead } from "@/components/customer/updates/MarkRead";
import { getT } from "@/lib/i18n/server";
import { buildInboxCards, type InboxPlan } from "@/lib/send/inbox";
import type { getCustomerContext } from "@/lib/customer/server";
import s from "./send.module.css";

type Ctx = Awaited<ReturnType<typeof getCustomerContext>>;

/**
 * "New from Coach {name}" cards for plans the coach sent and the member has not opened. Shown on Home and
 * Workouts for the selected member (a parent sees the child's). On Workouts (`markRead`) the cards count as
 * seen: the updates up to the newest card are marked read through the existing mark-read action.
 */
export async function NewFromCoach({ ctx, markRead = false }: { ctx: Ctx; markRead?: boolean }) {
  const { t, locale } = await getT();
  if (!ctx.selected) return null;
  const { principal, db, selected, today } = ctx;
  let cards: ReturnType<typeof buildInboxCards> = [];
  try {
    const [feed, assignments] = await Promise.all([
      listMemberUpdates(db, principal, selected.id, new URLSearchParams({ limit: "30" })),
      listPlanAssignments(db, principal, new URLSearchParams({ memberId: selected.id, limit: "50" })),
    ]);
    const planIds = new Set(assignments.items.map((a) => a.planId));
    const plans = new Map<string, InboxPlan>();
    await Promise.all(
      [...planIds].map(async (id) => {
        try {
          const p = await getWorkoutPlan(db, principal, id);
          plans.set(id, { id, title: p.title, days: p.days.map((d) => ({ items: d.items.map((i) => ({ exerciseName: i.exerciseName })) })) });
        } catch {
          /* a plan the member cannot open simply has no preview */
        }
      }),
    );
    cards = buildInboxCards(feed.items, assignments.items, plans, t, locale, today);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    return <p className="muted small" role="status">{t("ib.loadError")}</p>;
  }
  if (cards.length === 0) return null;
  const newest = cards.map((c) => c.createdAt).sort().at(-1)!;

  return (
    <section aria-label={t("ib.title")} className={s.inbox}>
      {cards.map((c) => (
        <Card as="article" key={c.updateId} className={s.inboxCard}>
          <span className={s.inboxTag}><Badge tone="info">{c.tag}</Badge></span>
          <h2 className={s.inboxTitle}>{c.planTitle}</h2>
          <p className={s.inboxMeta}>{[c.scheduleLine, c.exerciseCountText].filter(Boolean).join(" · ")}</p>
          {c.note && (
            <blockquote className={s.quote}>
              <span className={s.quoteLabel}>{t("ib.note")}</span>
              <p className={s.quoteText}>{c.note}</p>
            </blockquote>
          )}
          <div className={s.inboxActions}>
            <ButtonLink href="/customer/workouts">{t("ib.start")}</ButtonLink>
          </div>
          {c.exercises.length > 0 && (
            <details className={s.details}>
              <summary>{t("ib.preview")}</summary>
              <ul className={s.exList} aria-label={t("ib.previewLabel", { plan: c.planTitle })}>
                {c.exercises.map((e) => <li key={e}>{e}</li>)}
              </ul>
            </details>
          )}
        </Card>
      ))}
      {markRead && <MarkRead memberId={selected.id} upTo={newest} />}
    </section>
  );
}
