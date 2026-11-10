import { listBatches } from "@/lib/api/batches";
import { listMembers } from "@/lib/api/members";
import { listSessions } from "@/lib/api/sessions";
import { getT } from "@/lib/i18n/server";
import { getThemeForTenant } from "@/lib/theme";
import { prisma } from "@/lib/db";
import { getViewer } from "@/lib/viewer";

const LIMIT = new URLSearchParams({ limit: "100" });

function Empty({ text }: { text: string }) {
  return <p className="muted">{text}</p>;
}

function weekday(locale: string, isoDay: number) {
  // 2024-01-01 is a Monday, so ISO day N maps to January N, 2024.
  return new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(Date.UTC(2024, 0, isoDay));
}

export async function MembersScreen() {
  const { t } = await getT();
  const { principal, db } = await getViewer();
  const [members, batches] = await Promise.all([
    listMembers(db, principal, LIMIT),
    listBatches(db, principal, LIMIT),
  ]);
  const batchName = new Map(batches.items.map((b) => [b.id, b.name]));
  if (members.items.length === 0) return <Empty text={t("data.empty")} />;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{t("data.name")}</th>
            <th>{t("data.batch")}</th>
            <th>{t("data.level")}</th>
            <th>{t("data.fee")}</th>
            <th>{t("data.attendance")}</th>
          </tr>
        </thead>
        <tbody>
          {members.items.map((m) => (
            <tr key={m.id}>
              <td>{m.name}</td>
              <td>{m.batchIds.map((id) => batchName.get(id) ?? "").filter(Boolean).join(", ") || "–"}</td>
              <td>{m.level ?? "–"}</td>
              <td>{m.feeStatus ? t(`fee.${m.feeStatus}`) : "–"}</td>
              <td>{m.attendancePercent === null ? "–" : `${m.attendancePercent}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export async function BatchesScreen() {
  const { t, locale } = await getT();
  const { principal, db } = await getViewer();
  const batches = await listBatches(db, principal, LIMIT);
  if (batches.items.length === 0) return <Empty text={t("data.empty")} />;
  return (
    <ul className="card-list">
      {batches.items.map((b) => (
        <li key={b.id} className="card">
          <strong>{b.name}</strong>
          <div className="small muted">
            {b.sportName} · {b.venueName}
          </div>
          <div className="small">
            {t("data.members")}: {b.memberCount}
            {b.capacity ? ` / ${b.capacity}` : ""}
          </div>
          <div className="small">
            {b.schedule.length
              ? `${b.schedule.map((s) => weekday(locale, s.weekday)).join(", ")} · ${b.schedule[0].startTime}–${b.schedule[0].endTime}`
              : "–"}
          </div>
        </li>
      ))}
    </ul>
  );
}

export async function DashboardScreen() {
  const { t } = await getT();
  const { principal, db } = await getViewer();
  const [active, batches, overdue, recent] = await Promise.all([
    db.member.count({ where: { isActive: true } }),
    db.batch.count({ where: { isActive: true } }),
    db.member.count({ where: { isActive: true, feeStatus: "OVERDUE" } }),
    listSessions(db, principal, new URLSearchParams({ limit: "5" })),
  ]);
  return (
    <>
      <ul className="card-list">
        <li className="card"><strong>{active}</strong> <span className="muted">{t("dash.members")}</span></li>
        <li className="card"><strong>{batches}</strong> <span className="muted">{t("dash.batches")}</span></li>
        <li className="card"><strong>{overdue}</strong> <span className="muted">{t("dash.overdue")}</span></li>
      </ul>
      <h2>{t("dash.recent")}</h2>
      {recent.items.length === 0 ? (
        <Empty text={t("data.empty")} />
      ) : (
        <ul className="card-list">
          {recent.items.map((s) => (
            <li key={s.id} className="card">
              <strong>{s.batchName}</strong>
              <div className="small muted">
                {s.startsAt.slice(0, 10)} · {s.coachName} · {t(`status.${s.status}`)}
              </div>
              {s.attendanceSummary && (
                <div className="small">
                  {t("dash.present", { present: s.attendanceSummary.present, total: s.attendanceSummary.total })}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export async function CoachesScreen() {
  const { t } = await getT();
  const { db } = await getViewer();
  const coaches = await db.user.findMany({
    where: { role: "COACH" },
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true, batches: { where: { isActive: true }, select: { name: true } } },
  });
  if (coaches.length === 0) return <Empty text={t("data.empty")} />;
  return (
    <ul className="card-list">
      {coaches.map((c) => (
        <li key={c.id} className="card">
          <strong>{c.name}</strong>
          <div className="small muted">{c.email}</div>
          <div className="small">{c.batches.map((b) => b.name).join(", ") || "–"}</div>
        </li>
      ))}
    </ul>
  );
}

export async function SettingsScreen() {
  const { t } = await getT();
  const { principal, db } = await getViewer();
  const theme = await getThemeForTenant(prisma, principal.tenantId);
  const row = await db.tenantTheme.findFirst({ select: { defaultLocale: true } });
  const rows: [string, string][] = [
    [t("settings.business"), theme.displayName],
    [t("settings.logo"), theme.logoUrl ?? "–"],
    [t("settings.primary"), theme.primaryColor],
    [t("settings.secondary"), theme.secondaryColor],
    [t("settings.accent"), theme.accentColor ?? "–"],
    [t("settings.language"), row?.defaultLocale ?? "en"],
  ];
  return (
    <>
      <ul className="card-list">
        {rows.map(([label, value]) => (
          <li key={label} className="card">
            <span className="muted small">{label}</span>
            <div>{value}</div>
          </li>
        ))}
      </ul>
      <p className="muted">{t("settings.readonly")}</p>
    </>
  );
}
