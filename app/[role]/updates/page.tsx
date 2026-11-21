import { notFound } from "next/navigation";
import { listMemberUpdates } from "@/lib/api/member-updates";
import { ChildSwitcher } from "@/components/customer/ChildSwitcher";
import { NoMember } from "@/components/customer/NoMember";
import { MarkRead } from "@/components/customer/updates/MarkRead";
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { formatWhen } from "@/lib/customer/format";
import { describeUpdate, newestCreatedAt, type FeedUpdate } from "@/lib/customer/updates";
import { allow, getCustomerContext } from "@/lib/customer/server";
import { getT } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n";
import s from "@/components/customer/Customer.module.css";

export const dynamic = "force-dynamic";

/** Coach changes (plans, goals, sessions, bookings) for the chosen member, newest first, then marked read. */
export default async function UpdatesPage({ params }: { params: Promise<{ role: string }> }) {
  if ((await params).role !== "customer") notFound();
  const { t, locale } = await getT();
  const ctx = await getCustomerContext();
  if (!ctx.selected) return <NoMember />;
  const { principal, db, selected } = ctx;

  allow(principal, "listMemberUpdates");
  const feed = await listMemberUpdates(db, principal, selected.id, new URLSearchParams({ limit: "50" }));
  const items: FeedUpdate[] = feed.items.map((i) => ({ id: i.id, kind: i.kind, params: i.params, createdAt: i.createdAt, read: i.read }));
  const newest = newestCreatedAt(items);

  return (
    <div className={s.stack}>
      <PageHeader
        title={t("upd.title")}
        subtitle={t("upd.subtitle")}
        actions={<ButtonLink href="/customer/home" variant="secondary">{t("upd.backHome")}</ButtonLink>}
      />
      <ChildSwitcher members={ctx.children} selectedId={selected.id} />
      {items.length === 0 ? (
        <EmptyState title={t("upd.empty.title")} text={t("upd.empty.body")} icon="✉" />
      ) : (
        <>
          <ul className={s.feed}>
            {items.map((u) => {
              const view = describeUpdate(u, t, locale);
              return (
                <Card as="li" key={u.id} className={s.feedItem}>
                  <div data-new={!u.read} className={s.feedItem}>
                    <div className={s.row}>
                      <span>
                        <Badge>{t(`upd.cat.${view.category}` as MessageKey)}</Badge>{" "}
                        {!u.read && <Badge tone="info">{t("upd.new")}</Badge>}
                      </span>
                      <time className={s.meta} dateTime={u.createdAt}>{formatWhen(u.createdAt, locale)}</time>
                    </div>
                    <p style={{ margin: 0 }}>{view.text}</p>
                    {view.note && <blockquote className={s.quote}>{view.note}</blockquote>}
                  </div>
                </Card>
              );
            })}
          </ul>
          {newest && <MarkRead memberId={selected.id} upTo={newest} />}
        </>
      )}
    </div>
  );
}
