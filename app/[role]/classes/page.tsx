import { notFound } from "next/navigation";
import { ChildSwitcher } from "@/components/customer/ChildSwitcher";
import { NoMember } from "@/components/customer/NoMember";
import { ClassSummaryCard } from "@/components/classes/ClassSummaryCard";
import s from "@/components/classes/classes.module.css";
import { ButtonLink, EmptyState, ErrorState, PageHeader } from "@/components/ui";
import { ApiError } from "@/lib/auth/errors";
import { loadBelt, loadMemberSummaries } from "@/lib/classes/server";
import { allow, getCustomerContext } from "@/lib/customer/server";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

/** Customers: recent class summaries of the chosen member (a parent sees the selected child). */
export default async function ClassesPage({ params, searchParams }: { params: Promise<{ role: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if ((await params).role !== "customer") notFound();
  const sp = await searchParams;
  const cursor = typeof sp.cursor === "string" ? sp.cursor.slice(0, 200) : null;
  const { t } = await getT();
  const ctx = await getCustomerContext();
  if (!ctx.selected) return <NoMember />;
  const { principal, db, selected, now } = ctx;
  allow(principal, "getMemberClassSummaries");

  let page: Awaited<ReturnType<typeof loadMemberSummaries>> | null = null;
  try {
    page = await loadMemberSummaries(db, principal, selected.id, 10, cursor);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
  }
  const belt = page && page.items.length > 0 ? await loadBelt(db, principal, selected.id) : null;

  return (
    <div className={s.stack}>
      <PageHeader title={t("csm.list.title")} subtitle={t("csm.list.subtitle")} />
      <ChildSwitcher members={ctx.children} selectedId={selected.id} />
      {!page && <ErrorState title={t("ui.errorTitle")} message={t("csm.list.loadError")} />}
      {page && page.items.length === 0 && <EmptyState title={t("csm.list.empty.title")} text={t("csm.list.empty.text")} icon="◷" />}
      {page && page.items.length > 0 && (
        <ul className={s.list} aria-label={t("csm.list.recent")}>
          {page.items.map((x, i) => (
            <li key={x.id}>
              <ClassSummaryCard summary={x} belt={i === 0 && !cursor ? belt : null} now={now} href={`/customer/classes/${x.sessionId}`} headingLevel={2} />
            </li>
          ))}
        </ul>
      )}
      {page?.nextCursor && (
        <nav aria-label={t("csm.list.title")}>
          <ButtonLink variant="secondary" href={`?cursor=${encodeURIComponent(page.nextCursor)}`}>{t("csm.list.more")}</ButtonLink>
        </nav>
      )}
    </div>
  );
}
