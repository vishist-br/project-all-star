import { notFound } from "next/navigation";
import { ChildSwitcher } from "@/components/customer/ChildSwitcher";
import { NoMember } from "@/components/customer/NoMember";
import { ClassSummaryCard } from "@/components/classes/ClassSummaryCard";
import s from "@/components/classes/classes.module.css";
import { ButtonLink, EmptyState, PageHeader } from "@/components/ui";
import { loadBelt, loadMemberSummary } from "@/lib/classes/server";
import { allow, getCustomerContext } from "@/lib/customer/server";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

/** One class summary for the chosen member. A summary that is not theirs or not shared yet shows a friendly notice. */
export default async function ClassDetailPage({ params }: { params: Promise<{ role: string; sessionId: string }> }) {
  const { role, sessionId } = await params;
  if (role !== "customer") notFound();
  const { t } = await getT();
  const ctx = await getCustomerContext();
  if (!ctx.selected) return <NoMember />;
  const { principal, db, selected, now } = ctx;
  allow(principal, "getClassSummary");
  const back = <ButtonLink variant="ghost" href="/customer/classes">{t("csm.detail.back")}</ButtonLink>;

  const summary = await loadMemberSummary(db, principal, sessionId, selected.id);
  if (!summary) {
    return (
      <div className={s.stack}>
        <PageHeader title={t("csm.list.title")} actions={back} />
        <ChildSwitcher members={ctx.children} selectedId={selected.id} />
        <EmptyState title={t("csm.detail.notFound.title")} text={t("csm.detail.notFound.text")} icon="◷" action={back} />
      </div>
    );
  }
  const belt = await loadBelt(db, principal, selected.id);
  return (
    <div className={s.stack}>
      <PageHeader title={summary.batchName} actions={back} />
      <ChildSwitcher members={ctx.children} selectedId={selected.id} />
      <ClassSummaryCard summary={summary} belt={belt} now={now} headingLevel={2} />
    </div>
  );
}
