import { notFound } from "next/navigation";
import { QueueStatus } from "@/components/sessions/QueueStatus";
import { SessionCard } from "@/components/sessions/SessionCard";
import { SessionTabs } from "@/components/sessions/SessionTabs";
import s from "@/components/sessions/sessions.module.css";
import { ButtonLink } from "@/components/ui/Button";
import { Card, StatGrid, StatTile } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { listSessions, type SessionDto } from "@/lib/api/sessions";
import { listVenues } from "@/lib/api/venues";
import { ApiError } from "@/lib/auth/errors";
import { checkRole } from "@/lib/auth/guard";
import { getT } from "@/lib/i18n/server";
import { isRole } from "@/lib/nav";
import { addDays, formatDay, istDate, istTime, mondayOf } from "@/lib/sessions/week";
import { getViewer } from "@/lib/viewer";

/** Coach Today: today's and tomorrow's sessions, roll calls still open from earlier days, quick stats. */
export default async function TodayPage({ params }: { params: Promise<{ role: string }> }) {
  const { role } = await params;
  if (!isRole(role) || role !== "coach") notFound();
  const { t, locale } = await getT();
  const { db, principal } = await getViewer();
  if (principal.role !== "coach") notFound();
  checkRole(principal, "listSessions");

  const today = istDate(new Date());
  const tomorrow = addDays(today, 1);
  const monday = mondayOf(today);
  const list = async (from: string, to: string, status?: string) => {
    const p = new URLSearchParams({ from, to, limit: "100" });
    if (status) p.set("status", status);
    return (await listSessions(db, principal, p)).items;
  };

  let data: { upcoming: SessionDto[]; open: SessionDto[]; week: SessionDto[]; venues: Map<string, string> } | null = null;
  try {
    const [upcoming, open, week, venues] = await Promise.all([
      list(today, tomorrow),
      list(addDays(today, -21), addDays(today, -1), "scheduled"),
      list(monday, addDays(monday, 6)),
      listVenues(db, principal, new URLSearchParams({ limit: "100" })),
    ]);
    data = { upcoming, open, week, venues: new Map(venues.items.map((v) => [v.id, v.name])) };
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
  }

  const newSession = <ButtonLink href={`/${role}/sessions/new`}>{t("today.schedule")}</ButtonLink>;
  const byTime = (a: SessionDto, b: SessionDto) => a.startsAt.localeCompare(b.startsAt);
  const todays = data?.upcoming.filter((x) => istDate(x.startsAt) === today).sort(byTime) ?? [];
  const tomorrows = data?.upcoming.filter((x) => istDate(x.startsAt) === tomorrow).sort(byTime) ?? [];

  const group = (items: SessionDto[]) => (
    <ul className="card-list" style={{ margin: 0 }}>
      {items.map((x) => <SessionCard key={x.id} session={x} venue={data?.venues.get(x.venueId)} role={role} t={t} />)}
    </ul>
  );

  return (
    <>
      <PageHeader title={t("today.title")} subtitle={formatDay(today, locale, { weekday: "long", day: "numeric", month: "long" })} actions={newSession} />
      <SessionTabs role={role} active="today" />
      <QueueStatus userId={principal.userId} />

      {!data && <ErrorState title={t("ui.errorTitle")} message={t("today.loadError")} />}
      {data && (
        <>
          <StatGrid>
            <StatTile label={t("today.stat.sessions")} value={todays.length} />
            <StatTile label={t("today.stat.done")} value={`${todays.filter((x) => x.status === "completed").length}/${todays.length}`} />
            <StatTile label={t("today.stat.week")} value={data.week.filter((x) => x.status !== "cancelled").length} />
          </StatGrid>

          {data.open.length > 0 && (
            <section className={s.pendingBox} aria-labelledby="pending-h">
              <h2 id="pending-h">{t("today.pending.title")}</h2>
              <p>{t("today.pending.text")}</p>
              <ul className={s.pendingList}>
                {data.open.sort((a, b) => b.startsAt.localeCompare(a.startsAt)).slice(0, 5).map((x) => (
                  <li key={x.id} className={s.pendingItem}>
                    <span>{formatDay(istDate(x.startsAt), locale)} {istTime(x.startsAt)} · {x.batchName}</span>
                    <ButtonLink variant="secondary" href={`/${role}/sessions/${x.id}`}>{t("today.pending.open")}</ButtonLink>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <h2 className={s.sectionTitle}>{t("today.section.today")}</h2>
          {todays.length === 0 ? (
            <EmptyState title={t("today.empty.title")} text={t("today.empty.text")} action={newSession} />
          ) : (
            group(todays)
          )}

          <h2 className={s.sectionTitle}>{t("today.section.tomorrow")}</h2>
          {tomorrows.length === 0 ? <Card><p className="muted" style={{ margin: 0 }}>{t("today.emptyTomorrow")}</p></Card> : group(tomorrows)}
        </>
      )}
    </>
  );
}
