import Link from "next/link";
import { getMember } from "@/lib/api/members";
import { getMemberSchedule } from "@/lib/api/schedule";
import { loadTenantSettings } from "@/lib/api/tenant-settings";
import { ChildSwitcher } from "@/components/customer/ChildSwitcher";
import { NoMember } from "@/components/customer/NoMember";
import { Badge, Card, EmptyState, PageHeader, SectionHeader, Segmented } from "@/components/ui";
import { loadMyBookings } from "@/lib/customer/bookings";
import { formatDay } from "@/lib/customer/format";
import { allow, getCustomerContext } from "@/lib/customer/server";
import {
  addDaysTo,
  cancelOpen,
  isDate,
  isMonth,
  monthGrid,
  monthRange,
  shiftMonth,
  sessionAction,
  sortSessions,
} from "@/lib/customer/schedule";
import { getT } from "@/lib/i18n/server";
import { SessionCard, type SessionView } from "./SessionCard";
import s from "./Schedule.module.css";

type Search = Record<string, string | string[] | undefined>;
const one = (sp: Search, k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);

/** Customer Schedule: week list or month grid of the member's sessions, booking and waiting list, plus attendance history. */
export async function ScheduleScreen({ searchParams }: { searchParams: Search }) {
  const { t, locale } = await getT();
  const ctx = await getCustomerContext();
  if (!ctx.selected) return <NoMember />;
  const { principal, db, today, now, selected } = ctx;
  allow(principal, "getMemberSchedule");
  allow(principal, "getMember");

  const view = one(searchParams, "view") === "month" ? "month" : "week";
  const monthParam = one(searchParams, "month");
  const month = isMonth(monthParam) ? monthParam : today.slice(0, 7);
  const fromParam = one(searchParams, "from");
  const weekFrom = isDate(fromParam) ? fromParam : today;
  const range = view === "month" ? monthRange(month) : { from: weekFrom, to: addDaysTo(weekFrom, 6) };
  const dayParam = one(searchParams, "day");
  const day = isDate(dayParam) && dayParam >= range.from && dayParam <= range.to ? dayParam : undefined;

  const [schedule, settings, member] = await Promise.all([
    getMemberSchedule(db, principal, selected.id, new URLSearchParams(range)),
    loadTenantSettings(db),
    getMember(db, principal, selected.id),
  ]);
  const all = schedule.days.flatMap((d) => d.sessions);
  const bookings = await loadMyBookings(db, principal, selected.id, all, settings.bookingCancelWindowMinutes);

  const qs = (extra: Record<string, string>) => `?${new URLSearchParams({ view, ...extra }).toString()}`;
  const tabs = [
    { href: "?view=week", label: t("cs.view.week"), active: view === "week" },
    { href: "?view=month", label: t("cs.view.month"), active: view === "month" },
  ];

  const renderSession = (x: (typeof all)[number]) => {
    const card: SessionView = x;
    const past = new Date(x.startsAt).getTime() <= now.getTime();
    const b = bookings.get(x.id) ?? null;
    return (
      <SessionCard
        key={x.id}
        memberId={selected.id}
        session={card}
        action={sessionAction(x, now, settings.waitlistEnabled)}
        booking={b}
        canCancel={b ? cancelOpen(b.cancellableUntil, now) : false}
        past={past}
      />
    );
  };

  const shownDays = view === "month" ? schedule.days.filter((d) => d.date === day) : schedule.days;

  return (
    <div className={s.days}>
      <PageHeader
        title={t("cs.title")}
        subtitle={selected.isOwn ? t("cs.subtitle") : `${selected.name}. ${t("cs.subtitle")}`}
      />
      <ChildSwitcher members={ctx.children} selectedId={selected.id} />
      <Segmented label={t("cs.view.label")} items={tabs} />
      <p className="muted">{t("cs.window.note", { mins: settings.bookingCancelWindowMinutes })}</p>

      {view === "week" ? (
        <div className={s.pager}>
          <Link className="btn btn-secondary" href={qs({ from: addDaysTo(weekFrom, -7) })}>{t("cs.nav.prev")}</Link>
          <span className={s.pagerRange}>{t("cs.range", { from: formatDay(range.from, locale), to: formatDay(range.to, locale) })}</span>
          <Link className="btn btn-secondary" href={qs({ from: addDaysTo(weekFrom, 7) })}>{t("cs.nav.next")}</Link>
        </div>
      ) : (
        <>
          <div className={s.pager}>
            <Link className="btn btn-secondary" href={qs({ month: shiftMonth(month, -1) })}>{t("cs.nav.prev")}</Link>
            <span className={s.pagerRange}>
              {new Intl.DateTimeFormat(locale === "en" ? "en-IN" : locale === "hi" ? "hi-IN" : "kn-IN", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${month}-01T00:00:00Z`))}
            </span>
            <Link className="btn btn-secondary" href={qs({ month: shiftMonth(month, 1) })}>{t("cs.nav.next")}</Link>
          </div>
          <MonthGrid month={month} days={schedule.days} today={today} selected={day} locale={locale} qs={qs} label={(d, n) => t("cs.month.dayLabel", { day: formatDay(d, locale), n })} />
        </>
      )}

      {view === "month" && !day && <p className="muted">{t("cs.month.pick")}</p>}

      {(view === "week" || day) && (
        <section aria-label={view === "month" && day ? t("cs.month.on", { day: formatDay(day, locale) }) : t("cs.title")}>
          {view === "month" && day && <SectionHeader title={t("cs.month.on", { day: formatDay(day, locale) })} />}
          {shownDays.every((d) => d.sessions.length === 0 && !d.isHoliday && d.items.length === 0) && (
            <EmptyState title={t("cs.empty.title")} text={t("cs.empty.body")} icon="◷" />
          )}
          <ol className={s.days}>
            {shownDays
              .filter((d) => d.sessions.length > 0 || d.isHoliday || d.items.length > 0)
              .map((d) => (
                <li key={d.date} className={s.day} data-date={d.date}>
                  <div className={s.dayHead}>
                    <h2 className={`${s.dayTitle}${d.date === today ? ` ${s.dayToday}` : ""}`}>
                      {formatDay(d.date, locale)}
                      {d.date === today && ` · ${t("cs.today")}`}
                    </h2>
                    {d.items.length > 0 && (
                      <Link href="/customer/workouts" className={s.meta}>{t("cs.workouts", { n: d.items.length })}</Link>
                    )}
                  </div>
                  {d.isHoliday && <p className={s.holiday}>{t("cs.holiday", { name: d.holidayName ?? "" })}</p>}
                  {d.sessions.length > 0 && <ul className={s.sessionList}>{sortSessions(d.sessions).map(renderSession)}</ul>}
                </li>
              ))}
          </ol>
        </section>
      )}

      <Card title={t("cs.history.title")}>
        {member.recentSessions.length === 0 ? (
          <EmptyState title={t("cs.history.empty.title")} text={t("cs.history.empty.body")} icon="✓" />
        ) : (
          <ul className={s.attList} data-testid="attendance-history">
            {member.recentSessions.map((r) => (
              <li key={r.sessionId}>
                <span>{formatDay(r.date, locale)}</span>
                {r.attendance === "present" ? (
                  <Badge tone="ok">{t("cs.att.present")}</Badge>
                ) : r.attendance === "excused" ? (
                  <Badge tone="info">
                    {r.excusedReason ? t("cs.att.excusedReason", { reason: t(`cs.reason.${r.excusedReason}`) }) : t("cs.att.excused")}
                  </Badge>
                ) : r.attendance === "absent" ? (
                  <Badge>{t("cs.att.absent")}</Badge>
                ) : (
                  <Badge>{t("cs.att.notMarked")}</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function MonthGrid({
  month,
  days,
  today,
  selected,
  locale,
  qs,
  label,
}: {
  month: string;
  days: { date: string; isHoliday: boolean; sessions: unknown[] }[];
  today: string;
  selected: string | undefined;
  locale: string;
  qs: (extra: Record<string, string>) => string;
  label: (date: string, n: number) => string;
}) {
  const by = new Map(days.map((d) => [d.date, d]));
  const tag = locale === "hi" ? "hi-IN" : locale === "kn" ? "kn-IN" : "en-IN";
  // Monday-first weekday headers from a known Monday.
  const heads = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(tag, { timeZone: "UTC", weekday: "narrow" }).format(new Date(Date.UTC(2024, 0, 1 + i))),
  );
  return (
    <table className={s.grid} data-testid="month-grid">
      <thead>
        <tr>{heads.map((h, i) => <th key={i} scope="col" aria-hidden="true">{h}</th>)}</tr>
      </thead>
      <tbody>
        {monthGrid(month).map((row, ri) => (
          <tr key={ri}>
            {row.map((date, ci) => {
              if (!date) return <td key={ci} />;
              const d = by.get(date);
              const n = d?.sessions.length ?? 0;
              return (
                <td key={ci}>
                  <Link
                    href={qs({ month, day: date })}
                    className={`${s.cell}${d?.isHoliday ? ` ${s.cellHoliday}` : ""}`}
                    aria-label={label(date, n)}
                    aria-current={date === today ? "date" : undefined}
                    data-selected={date === selected || undefined}
                  >
                    <span>{Number(date.slice(8))}</span>
                    <span className={s.dots} aria-hidden="true">{"•".repeat(Math.min(n, 3))}</span>
                  </Link>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
