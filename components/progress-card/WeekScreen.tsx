import { notFound } from "next/navigation";
import { getProgressCard, listProgressCardLinks } from "@/lib/api/progress-card";
import { ApiError } from "@/lib/auth/errors";
import { ChildSwitcher } from "@/components/customer/ChildSwitcher";
import { NoMember } from "@/components/customer/NoMember";
import { ButtonLink, PageHeader } from "@/components/ui";
import { allow, getCustomerContext } from "@/lib/customer/server";
import { getT } from "@/lib/i18n/server";
import { addDays } from "@/lib/api/schedule";
import { mondayOf } from "@/lib/progress-card/rules";
import { CardView } from "./CardView";
import { ShareControls } from "./ShareControls";
import s from "./progress-card.module.css";

/** Customer weekly progress card: the card, week navigation, print and the share link controls. */
export async function WeekScreen({ week }: { week?: string }) {
  const { t } = await getT();
  const ctx = await getCustomerContext();
  if (!ctx.selected) return <NoMember />;
  const { principal, db, today, selected } = ctx;
  for (const op of ["getProgressCard", "listProgressCardLinks"] as const) allow(principal, op);

  let card: Awaited<ReturnType<typeof getProgressCard>>;
  try {
    card = await getProgressCard(db, principal, selected.id, new URLSearchParams(week ? { week } : {}));
  } catch (err) {
    if (err instanceof ApiError && err.code === "validation_failed") notFound();
    throw err;
  }
  const links = await listProgressCardLinks(db, principal, selected.id);
  const current = mondayOf(today);
  const base = "/customer/progress/week";

  return (
    <div className={s.stack}>
      <div className={s.noPrint}>
        <PageHeader title={t("pc.title")} subtitle={selected.isOwn ? t("pc.subtitle.self") : t("pc.subtitle.child", { name: selected.name })} />
        <ChildSwitcher members={ctx.children} selectedId={selected.id} />
        <nav className={s.weekNav} aria-label={t("pc.week.nav")}>
          <ButtonLink variant="secondary" href={`${base}?week=${addDays(card.weekStart, -7)}`} prefetch={false}>{t("pc.week.prev")}</ButtonLink>
          {card.weekStart !== current && <ButtonLink variant="secondary" href={base}>{t("pc.week.current")}</ButtonLink>}
          {card.weekStart < current && <ButtonLink variant="secondary" href={`${base}?week=${addDays(card.weekStart, 7)}`} prefetch={false}>{t("pc.week.next")}</ButtonLink>}
        </nav>
      </div>
      <CardView card={card} />
      <ShareControls
        key={`${selected.id}-${card.weekStart}`}
        memberId={selected.id}
        weekStart={card.weekStart}
        links={links.items.map((l) => ({ id: l.id, weekStart: l.weekStart, expiresAt: l.expiresAt }))}
      />
    </div>
  );
}
