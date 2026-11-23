import Link from "next/link";
import { notFound } from "next/navigation";
import { NotAllowed } from "@/components/NotAllowed";
import { formatNumber, formatPercent } from "@/components/owner/dashboard/view-model";
import s from "@/components/owner/coaches/coaches.module.css";
import { COACH_SORTS, barWidth, loadBand, parseCoachSort, sortCoachRows, type CoachRow } from "@/components/owner/coaches/view-model";
import { Avatar, Badge, ProgressBar, type Tone } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { ErrorState, EmptyState } from "@/components/ui/States";
import { Segmented } from "@/components/ui/Tabs";
import { getCoachWorkload } from "@/lib/api/analytics";
import { credentialsByCoach } from "@/lib/api/coach-credentials";
import { listCoaches } from "@/lib/api/coaches";
import { checkRole } from "@/lib/auth/guard";
import { getT } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n";
import { isRole } from "@/lib/nav";
import { getViewer } from "@/lib/viewer";

const BAND_TONE: Record<string, Tone> = { light: "info", balanced: "ok", full: "warn", unknown: "neutral" };

/** Owner coaches list: workload at a glance, each coach links to their detail page. Owner only. */
export default async function CoachesPage({ params, searchParams }: { params: Promise<{ role: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { role } = await params;
  if (!isRole(role)) notFound();
  const sp = await searchParams;
  const { t, locale } = await getT();
  const { principal, db } = await getViewer();
  if (principal.role !== "owner" || role !== "owner") return <NotAllowed role={principal.role} />;
  checkRole(principal, "listCoaches");

  const sort = parseCoachSort(sp.sort);
  const now = new Date();
  let list: Awaited<ReturnType<typeof listCoaches>> | null = null;
  try {
    list = await listCoaches(db, now);
  } catch (err) {
    console.error("owner coaches list failed", err instanceof Error ? err.message : err);
  }
  // Workload is a second, optional panel: if it fails the list still shows.
  let load = new Map<string, number | null>();
  if (list) {
    try {
      const w = await getCoachWorkload(db, new URLSearchParams(), now);
      load = new Map(w.items.map((c) => [c.coachId, c.loadPercent]));
    } catch (err) {
      console.error("owner coach workload failed", err instanceof Error ? err.message : err);
    }
  }

  let creds: Awaited<ReturnType<typeof credentialsByCoach>> = new Map();
  if (list) {
    try {
      creds = await credentialsByCoach(db, list.items.map((c) => c.id));
    } catch (err) {
      console.error("owner coach credentials failed", err instanceof Error ? err.message : err);
    }
  }

  const header = <PageHeader title={t("nav.coaches")} subtitle={t("oc.subtitle")} />;
  if (!list) {
    return (
      <>
        {header}
        <div className={s.errorBox}>
          <ErrorState title={t("od.error.title")} message={t("od.error.text")} />
          <ButtonLink variant="secondary" href="/owner/coaches">{t("od.error.retry")}</ButtonLink>
        </div>
      </>
    );
  }
  if (list.items.length === 0) return (
    <>
      {header}
      <EmptyState title={t("oc.empty.title")} text={t("oc.empty.text")} />
    </>
  );

  const rows = sortCoachRows(
    list.items.map((c) => ({ ...c, loadPercent: load.get(c.id) ?? null })) satisfies (CoachRow & typeof list.items[number])[],
    sort,
  );
  const num = (n: number) => formatNumber(n, locale) ?? "0";

  return (
    <>
      {header}
      <div className={s.toolbar}>
        <div className={s.sort}>
          <Segmented
            label={t("oc.sort.label")}
            items={COACH_SORTS.map((k) => ({ href: `?sort=${k}`, label: t(`oc.sort.${k}` as MessageKey), active: k === sort }))}
          />
        </div>
        <ButtonLink variant="secondary" href="/owner/batches">{t("nav.batches")}</ButtonLink>
      </div>
      <ul className={s.cards} aria-label={t("oc.list.label")}>
        {rows.map((c) => {
          const band = loadBand(c.loadPercent);
          const pct = formatPercent(c.loadPercent, locale);
          return (
            <Card as="li" key={c.id} className={s.card}>
              <div className={s.head}>
                <Avatar name={c.name} />
                <Link href={`/owner/coaches/${c.id}`} className={s.name} aria-label={t("oc.open", { name: c.name })}>
                  {c.name}
                </Link>
                {band !== "unknown" && <Badge tone={BAND_TONE[band]}>{t(`oc.band.${band}` as MessageKey)}</Badge>}
              </div>
              <dl className={s.facts}>
                <div><dt>{t("oc.batches")}</dt><dd>{num(c.batchCount)}</dd></div>
                <div><dt>{t("oc.members")}</dt><dd>{num(c.memberCount)}</dd></div>
                <div><dt>{t("oc.upcoming")}</dt><dd>{num(c.upcomingSessions7d)}</dd></div>
                <div><dt>{t("oc.assignments")}</dt><dd>{num(c.activeAssignments)}</dd></div>
              </dl>
              <p className={s.na}>
                {(() => {
                  const mine = creds.get(c.id) ?? [];
                  const v = mine.filter((x) => x.verified).length;
                  return `${t("cred.title")}: ${t("cred.count.verified", { n: v })} · ${t("cred.count.unverified", { n: mine.length - v })}`;
                })()}
              </p>
              <div className={s.load}>
                <div className={s.loadHead}>
                  <span>{t("oc.load")}</span>
                  {pct ? <strong>{t("oc.load.value", { value: pct })}</strong> : <span className={s.na}>{t("an.notEnough")}</span>}
                </div>
                <ProgressBar value={c.loadPercent === null ? null : barWidth(c.loadPercent)} label={t("oc.load")} />
              </div>
            </Card>
          );
        })}
      </ul>
    </>
  );
}
