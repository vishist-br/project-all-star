import { notFound } from "next/navigation";
import { AssignmentResults } from "@/components/send/AssignmentResults";
import s from "@/components/send/send.module.css";
import { ButtonLink } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { Segmented } from "@/components/ui/Tabs";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { ApiError } from "@/lib/auth/errors";
import { checkRole } from "@/lib/auth/guard";
import type { MessageKey } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { isRole } from "@/lib/nav";
import { parseRange, RESULT_RANGES } from "@/lib/send/results";
import { loadPlanResultViews } from "@/lib/send/server";
import { getViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

/** What members logged for one plan. Owner and the plan's coach. Members are listed by name, never ranked. */
export default async function PlanResultsPage({
  params,
  searchParams,
}: {
  params: Promise<{ role: string; planId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { role, planId } = await params;
  if (!isRole(role) || role === "customer") notFound();
  const sp = await searchParams;
  const days = parseRange(sp.days);
  const memberId = typeof sp.memberId === "string" && sp.memberId ? sp.memberId.slice(0, 64) : null;
  const { t } = await getT();
  const { db, principal } = await getViewer();
  if (principal.role === "customer") notFound();
  checkRole(principal, "getPlanResults");

  const back = <ButtonLink variant="ghost" href={`/${role}/plans`}>{t("rs.back")}</ButtonLink>;
  let data: Awaited<ReturnType<typeof loadPlanResultViews>> | null = null;
  try {
    data = await loadPlanResultViews(db, principal, planId, { days, memberId, t });
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    if (err.code === "not_found") notFound();
    if (err.code === "forbidden") {
      return (
        <>
          <PageHeader title={t("rs.title")} actions={back} />
          <div className={s.notice} role="status"><p>{t("rs.notYours")}</p></div>
        </>
      );
    }
  }
  if (!data) {
    return (
      <>
        <PageHeader title={t("rs.title")} actions={back} />
        <ErrorState title={t("ui.errorTitle")} message={t("rs.loadError")} />
      </>
    );
  }
  const base = `/${role}/plans/${planId}/results`;
  const only = memberId && data.views.length === 1 ? data.views[0]!.memberName : null;

  return (
    <>
      <PageHeader title={t("rs.title")} subtitle={t("rs.subtitle", { plan: data.planTitle })} actions={back} />
      <div className={s.stack}>
        <Segmented
          label={t("rs.range")}
          items={RESULT_RANGES.map((d) => ({
            href: `${base}?days=${d}${memberId ? `&memberId=${memberId}` : ""}`,
            label: t(`rs.range.${d}` as MessageKey),
            active: d === days,
          }))}
        />
        {only && (
          <p className={s.resMeta}>
            {t("rs.filteredFor", { name: only })} · <a href={`${base}?days=${days}`}>{t("rs.showAll")}</a>
          </p>
        )}
        {data.views.length === 0 ? (
          <EmptyState
            title={t("rs.empty.title")}
            text={t("rs.empty.text")}
            action={<ButtonLink href={`/${role}/plans/${planId}/send`}>{t("rs.empty.action")}</ButtonLink>}
            icon="☰"
          />
        ) : (
          data.views.map((v) => <AssignmentResults key={v.assignmentId} view={v} role={role} planId={planId} />)
        )}
        <p className={s.footnote}>{t("rs.footnote")}</p>
      </div>
    </>
  );
}
