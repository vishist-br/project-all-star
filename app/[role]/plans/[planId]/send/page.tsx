import { notFound } from "next/navigation";
import { SendScreen } from "@/components/send/SendScreen";
import s from "@/components/send/send.module.css";
import { ButtonLink } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { listBatches } from "@/lib/api/batches";
import { listMembers } from "@/lib/api/members";
import { tenantDate } from "@/lib/api/pagination";
import { getWorkoutPlan } from "@/lib/api/workout-plans";
import { ApiError } from "@/lib/auth/errors";
import { checkRole } from "@/lib/auth/guard";
import { getT } from "@/lib/i18n/server";
import { isRole } from "@/lib/nav";
import { coachLabel, summarizePlan, type BatchRow, type MemberRow } from "@/lib/send/view";
import { getViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

/** Send one plan to several members (coach: own members; owner: everyone). */
export default async function SendPlanPage({ params }: { params: Promise<{ role: string; planId: string }> }) {
  const { role, planId } = await params;
  if (!isRole(role) || role === "customer") notFound();
  const { t } = await getT();
  const { db, principal } = await getViewer();
  if (principal.role === "customer") notFound();
  checkRole(principal, "sendPlanToMembers");
  const back = <ButtonLink variant="ghost" href={`/${role}/plans`}>{t("snd.back")}</ButtonLink>;

  let plan: Awaited<ReturnType<typeof getWorkoutPlan>>;
  try {
    plan = await getWorkoutPlan(db, principal, planId);
  } catch (err) {
    if (err instanceof ApiError && err.code === "not_found") notFound();
    if (err instanceof ApiError && err.code === "forbidden") return <Notice title={t("snd.title")} text={t("snd.notice.notYours")} actions={back} />;
    throw err;
  }
  const mine = principal.role === "owner" || plan.coachId === principal.userId;
  if (!mine) return <Notice title={plan.title} text={t("snd.notice.notYours")} actions={back} />;
  const open = <ButtonLink variant="secondary" href={`/${role}/plans/${plan.id}`}>{t("snd.notice.openPlan")}</ButtonLink>;
  if (plan.status === "archived") return <Notice title={plan.title} text={t("snd.notice.archived")} actions={back} />;
  if (plan.status === "draft") return <Notice title={plan.title} text={t("snd.notice.draft")} actions={open} />;
  const summary = summarizePlan(plan.days);
  if (summary.exercises === 0) return <Notice title={plan.title} text={t("snd.notice.empty")} actions={open} />;

  let loadFailed = false;
  const members: MemberRow[] = [];
  let batches: BatchRow[] = [];
  try {
    let cursor: string | null = null;
    for (let page = 0; page < 5; page += 1) {
      const q = new URLSearchParams({ limit: "100", status: "active" });
      if (cursor) q.set("cursor", cursor);
      const res: Awaited<ReturnType<typeof listMembers>> = await listMembers(db, principal, q);
      members.push(...res.items.map((m) => ({ id: m.id, name: m.name, level: m.level, batchIds: m.batchIds })));
      cursor = res.nextCursor;
      if (!cursor) break;
    }
    const b = await listBatches(db, principal, new URLSearchParams({ limit: "100" }));
    batches = b.items.map((x) => ({ id: x.id, name: x.name }));
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    loadFailed = true;
  }
  const me = await db.user.findFirst({ where: { id: principal.userId }, select: { name: true } });

  return (
    <>
      <PageHeader title={t("snd.title")} subtitle={t("snd.subtitle")} actions={back} />
      <SendScreen
        role={role}
        plan={{ id: plan.id, title: plan.title }}
        summary={summary}
        members={members}
        batches={batches}
        coachName={coachLabel(me?.name)}
        today={tenantDate(new Date())}
        loadFailed={loadFailed}
      />
    </>
  );
}

function Notice({ title, text, actions }: { title: string; text: string; actions: React.ReactNode }) {
  return (
    <>
      <PageHeader title={title} />
      <div className={s.notice} role="status">
        <p>{text}</p>
        <div className="actions">{actions}</div>
      </div>
    </>
  );
}
