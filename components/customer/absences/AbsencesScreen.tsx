import Link from "next/link";
import { listExcusedAbsences } from "@/lib/api/excused-absences";
import { getMemberSchedule } from "@/lib/api/schedule";
import { ChildSwitcher } from "@/components/customer/ChildSwitcher";
import { NoMember } from "@/components/customer/NoMember";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { formatDay, formatWhen } from "@/lib/customer/format";
import { allow, getCustomerContext } from "@/lib/customer/server";
import { addDaysTo } from "@/lib/customer/schedule";
import type { MessageKey } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { AbsenceForm } from "./AbsenceForm";
import { WithdrawButton } from "./WithdrawButton";
import s from "../Customer.module.css";

/** Days of upcoming sessions offered in the picker. */
const HORIZON_DAYS = 28;

/** Customer "Plan an absence": tell the coach ahead of time, see and withdraw what was declared. Visibility for the coach, not a penalty. */
export async function AbsencesScreen({ sessionId }: { sessionId?: string }) {
  const { t, locale } = await getT();
  const ctx = await getCustomerContext();
  if (!ctx.selected) return <NoMember />;
  const { principal, db, today, now, selected } = ctx;
  allow(principal, "listExcusedAbsences");
  allow(principal, "getMemberSchedule");

  const [declared, schedule] = await Promise.all([
    listExcusedAbsences(db, principal, selected.id, new URLSearchParams()),
    getMemberSchedule(db, principal, selected.id, new URLSearchParams({ from: today, to: addDaysTo(today, HORIZON_DAYS) })),
  ]);
  const declaredSessions = new Set(declared.items.map((d) => d.sessionId).filter((x): x is string => x !== null));
  const upcoming = schedule.days
    .flatMap((d) => d.sessions)
    .filter((x) => x.status === "scheduled" && new Date(x.startsAt).getTime() > now.getTime() && !declaredSessions.has(x.id))
    .map((x) => ({ id: x.id, label: `${x.batchName} · ${formatWhen(x.startsAt, locale)}` }));
  const sessionLabel = new Map(schedule.days.flatMap((d) => d.sessions).map((x) => [x.id, `${x.batchName} · ${formatWhen(x.startsAt, locale)}`]));

  return (
    <div className={s.stack}>
      <PageHeader
        title={t("abs.title")}
        subtitle={selected.isOwn ? t("abs.subtitle") : `${selected.name}. ${t("abs.subtitle")}`}
        actions={<Link className="btn btn-secondary" href="/customer/schedule">{t("abs.back")}</Link>}
      />
      <ChildSwitcher members={ctx.children} selectedId={selected.id} />

      <Card title={t("abs.form.title")}>
        <p className="muted">{t("abs.intro")}</p>
        <AbsenceForm key={selected.id} memberId={selected.id} today={today} sessions={upcoming} initialSessionId={sessionId} />
      </Card>

      <Card title={t("abs.list.title")}>
        {declared.items.length === 0 ? (
          <EmptyState title={t("abs.list.empty.title")} text={t("abs.list.empty.body")} icon="◷" />
        ) : (
          <ul className={s.sessionList} data-testid="absence-list">
            {declared.items.map((d) => (
              <li key={d.id} data-testid="absence" data-reason={d.reason}>
                <div className={s.row}>
                  <p className={s.big}>
                    {d.sessionId
                      ? (sessionLabel.get(d.sessionId) ?? formatDay(d.fromDate, locale))
                      : d.fromDate === d.toDate
                        ? formatDay(d.fromDate, locale)
                        : t("abs.range", { from: formatDay(d.fromDate, locale), to: formatDay(d.toDate, locale) })}
                  </p>
                  <Badge tone="info">{t(`sess.reason.${d.reason}` as MessageKey)}</Badge>
                </div>
                {d.note && <p className={s.meta}>{d.note}</p>}
                <p className={s.meta}>{t("abs.list.seen")}</p>
                <div>
                  <WithdrawButton absenceId={d.id} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
