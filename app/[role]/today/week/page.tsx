import { notFound } from "next/navigation";
import { SessionTabs } from "@/components/sessions/SessionTabs";
import s from "@/components/sessions/sessions.module.css";
import { Badge, type Tone } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { listSessions, type SessionDto } from "@/lib/api/sessions";
import { ApiError } from "@/lib/auth/errors";
import { checkRole } from "@/lib/auth/guard";
import type { MessageKey } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { isRole } from "@/lib/nav";
import { addDays, formatDay, groupByDate, isDateString, istDate, istTime, mondayOf, weekDays } from "@/lib/sessions/week";
import { getViewer } from "@/lib/viewer";

const TONE: Record<string, Tone> = { scheduled: "info", completed: "ok", cancelled: "neutral" };

/** Coach week view: seven days in a list that reads well at 360px, each with its sessions. */
export default async function WeekPage({ params, searchParams }: { params: Promise<{ role: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { role } = await params;
  if (!isRole(role) || role !== "coach") notFound();
  const sp = await searchParams;
  const today = istDate(new Date());
  const startParam = typeof sp.start === "string" && isDateString(sp.start) ? sp.start : today;
  const monday = mondayOf(startParam);
  const sunday = addDays(monday, 6);

  const { t, locale } = await getT();
  const { db, principal } = await getViewer();
  if (principal.role !== "coach") notFound();
  checkRole(principal, "listSessions");

  let items: SessionDto[] | null = null;
  try {
    items = (await listSessions(db, principal, new URLSearchParams({ from: monday, to: sunday, limit: "100" }))).items;
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
  }
  const byDay = groupByDate(items ?? []);

  return (
    <>
      <PageHeader
        title={t("today.title")}
        subtitle={t("week.title", { from: formatDay(monday, locale), to: formatDay(sunday, locale) })}
        actions={<ButtonLink href={`/${role}/sessions/new`}>{t("today.schedule")}</ButtonLink>}
      />
      <SessionTabs role={role} active="week" />
      <nav className={s.weekNav} aria-label={t("week.nav")}>
        <ButtonLink variant="secondary" href={`?start=${addDays(monday, -7)}`}>{t("week.prev")}</ButtonLink>
        <ButtonLink variant="ghost" href={`?start=${today}`}>{t("week.thisWeek")}</ButtonLink>
        <ButtonLink variant="secondary" href={`?start=${addDays(monday, 7)}`}>{t("week.next")}</ButtonLink>
      </nav>
      {!items && <ErrorState title={t("ui.errorTitle")} message={t("today.loadError")} />}
      {items && items.length === 0 && (
        <EmptyState title={t("week.empty.title")} text={t("week.empty.text")} action={<ButtonLink href={`/${role}/sessions/new`}>{t("today.schedule")}</ButtonLink>} />
      )}
      {items && items.length > 0 && (
        <ol className={s.dayList} aria-label={t("week.list")}>
          {weekDays(monday).map((d) => {
            const list = byDay.get(d) ?? [];
            return (
              <li key={d} className={`${s.day}${d === today ? ` ${s.dayToday}` : ""}`}>
                <div className={s.dayHead}>
                  <h2 className={s.dayName}>{formatDay(d, locale, { weekday: "long", day: "numeric", month: "short" })}</h2>
                  {d === today && <Badge tone="info">{t("week.today")}</Badge>}
                </div>
                {list.length === 0 ? (
                  <p className={s.dayEmpty}>{t("week.noSessions")}</p>
                ) : (
                  <ul className={s.dayItems}>
                    {list.map((x) => (
                      <li key={x.id} className={s.dayItem}>
                        <span className={s.dayItemText}>
                          <span className={s.dayItemName}>{x.batchName}</span>
                          <span className={s.meta}>{istTime(x.startsAt)} – {istTime(x.endsAt)}</span>
                        </span>
                        <span className={s.chips}>
                          <Badge tone={TONE[x.status] ?? "neutral"}>{t(`card.status.${x.status}` as MessageKey)}</Badge>
                          {x.status !== "cancelled" && <ButtonLink variant="secondary" href={`/${role}/sessions/${x.id}`}>{t("card.open")}</ButtonLink>}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
