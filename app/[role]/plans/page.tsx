import Link from "next/link";
import { notFound } from "next/navigation";
import { PlanActions } from "@/components/plans/PlanActions";
import { PlanSendLinks } from "@/components/send/SendLinks";
import s from "@/components/plans/plans.module.css";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Select, TextInput } from "@/components/ui/Form";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { listWorkoutPlans } from "@/lib/api/workout-plans";
import { ApiError } from "@/lib/auth/errors";
import { checkRole } from "@/lib/auth/guard";
import { getT } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n";
import { isRole } from "@/lib/nav";
import { getViewer } from "@/lib/viewer";

const STATUSES = ["draft", "active", "archived"] as const;
const TONE: Record<string, Tone> = { draft: "neutral", active: "ok", archived: "warn" };

type Search = Record<string, string | string[] | undefined>;

/** Plans of the signed-in coach (the owner sees every plan in the business). Real data via the same lib/api function as GET /workout-plans. */
export default async function PlansPage({ params, searchParams }: { params: Promise<{ role: string }>; searchParams: Promise<Search> }) {
  const { role } = await params;
  if (!isRole(role) || role === "customer") notFound();
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).slice(0, 100) : "");
  const q = one("q");
  const status = (STATUSES as readonly string[]).includes(one("status")) ? one("status") : "";
  const cursor = one("cursor");

  const { t, locale } = await getT();
  const { db, principal } = await getViewer();
  // The role layout already shows "not available" to other roles; stop quietly here instead of throwing.
  if (principal.role === "customer") notFound();
  checkRole(principal, "listWorkoutPlans");

  const query = new URLSearchParams({ limit: "20" });
  if (q) query.set("q", q);
  if (status) query.set("status", status);
  if (cursor) query.set("cursor", cursor);
  let result: Awaited<ReturnType<typeof listWorkoutPlans>> | null = null;
  try {
    result = await listWorkoutPlans(db, principal, query);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
  }

  const filtered = Boolean(q || status);
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale === "en" ? "en-IN" : locale, { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
  const nextHref = (c: string) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (status) p.set("status", status);
    p.set("cursor", c);
    return `?${p.toString()}`;
  };

  return (
    <>
      <PageHeader
        title={t("plans.title")}
        subtitle={t("plans.subtitle")}
        actions={<ButtonLink href={`/${role}/plans/new`}>{t("plans.new")}</ButtonLink>}
      />
      <form method="get" className={s.toolbar} role="search" aria-label={t("plans.search")}>
        <div className="field">
          <label className="field-label" htmlFor="pl-q">{t("plans.search")}</label>
          <TextInput id="pl-q" type="search" name="q" defaultValue={q} autoComplete="off" />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="pl-status">{t("plans.statusFilter")}</label>
          <Select id="pl-status" name="status" defaultValue={status}>
            <option value="">{t("plans.all")}</option>
            {STATUSES.map((v) => <option key={v} value={v}>{t(`plans.status.${v}` as MessageKey)}</option>)}
          </Select>
        </div>
        <Button type="submit">{t("plans.show")}</Button>
      </form>

      {!result && <ErrorState title={t("ui.errorTitle")} message={t("plans.loadError")} />}
      {result && result.items.length === 0 && (
        filtered ? (
          <EmptyState title={t("plans.empty.filtered")} />
        ) : (
          <EmptyState
            title={t("plans.empty.title")}
            text={t("plans.empty.text")}
            action={<ButtonLink href={`/${role}/plans/new`}>{t("plans.new")}</ButtonLink>}
          />
        )
      )}
      {result && result.items.length > 0 && (
        <ul className="card-list" aria-label={t("plans.title")}>
          {result.items.map((p) => (
            <Card as="li" key={p.id} className={s.planCard}>
              <div className={s.planTop}>
                <h2 className={s.planTitle}>
                  {p.status === "archived" ? p.title : <Link href={`/${role}/plans/${p.id}`}>{p.title}</Link>}
                </h2>
                <div className={s.chips}>
                  <Badge tone={TONE[p.status] ?? "neutral"}>{t(`plans.status.${p.status}` as MessageKey)}</Badge>
                  <Badge tone="info">{t(`plans.cadence.${p.cadence}` as MessageKey)}</Badge>
                </div>
              </div>
              <p className={s.meta}>
                {[
                  t("plans.exercisesCount", { n: p.itemCount }),
                  t("plans.daysCount", { n: p.dayCount }),
                  t("plans.assigneesCount", { n: p.activeAssignmentCount }),
                  role === "owner" ? t("plans.by", { coach: p.coachName }) : null,
                  t("plans.updated", { date: date(p.updatedAt) }),
                ].filter(Boolean).join(" · ")}
              </p>
              <PlanActions role={role} plan={{ id: p.id, title: p.title, status: p.status }} />
              {p.status !== "archived" && <PlanSendLinks role={role} plan={{ id: p.id, title: p.title, status: p.status }} />}
            </Card>
          ))}
        </ul>
      )}
      {result?.nextCursor && (
        <nav className={s.pager} aria-label={t("plans.title")}>
          <ButtonLink variant="secondary" href={nextHref(result.nextCursor)}>{t("wk.next")}</ButtonLink>
        </nav>
      )}
    </>
  );
}
