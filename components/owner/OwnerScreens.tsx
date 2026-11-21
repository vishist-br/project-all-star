import { listBatches } from "@/lib/api/batches";
import { listMembers } from "@/lib/api/members";
import { listSessions } from "@/lib/api/sessions";
import { getT } from "@/lib/i18n/server";
import { getThemeForTenant } from "@/lib/theme";
import { prisma } from "@/lib/db";
import type { ReactNode } from "react";
import { getViewer } from "@/lib/viewer";
import { BarChart } from "@/components/charts";
import { Avatar, Badge, type Tone } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { Card, StatGrid, StatTile } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { SectionHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/States";

const LIMIT = new URLSearchParams({ limit: "100" });

const FEE_TONE: Record<string, Tone> = { paid: "ok", due: "warn", overdue: "danger" };
const SESSION_TONE: Record<string, Tone> = { completed: "ok", scheduled: "info", cancelled: "neutral" };

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
  if (members.items.length === 0)
    return (
      <EmptyState
        title={t("data.empty")}
        text={t("members.emptyHint")}
        action={<ButtonLink href="/owner/members/import">{t("import.title")}</ButtonLink>}
      />
    );
  return (
    <DataTable
      caption={t("nav.members")}
      rows={members.items}
      rowKey={(m) => m.id}
      columns={[
        { key: "name", header: t("data.name"), render: (m) => m.name },
        { key: "batch", header: t("data.batch"), render: (m) => m.batchIds.map((id) => batchName.get(id) ?? "").filter(Boolean).join(", ") || "–" },
        { key: "level", header: t("data.level"), render: (m) => m.level ?? "–" },
        {
          key: "fee",
          header: t("data.fee"),
          render: (m) => (m.feeStatus ? <Badge tone={FEE_TONE[m.feeStatus] ?? "neutral"}>{t(`fee.${m.feeStatus}`)}</Badge> : "–"),
        },
        { key: "att", header: t("data.attendance"), align: "end", render: (m) => (m.attendancePercent === null ? "–" : `${m.attendancePercent}%`) },
      ]}
    />
  );
}

export async function BatchesScreen() {
  const { t, locale } = await getT();
  const { principal, db } = await getViewer();
  const batches = await listBatches(db, principal, LIMIT);
  if (batches.items.length === 0) return <EmptyState title={t("data.empty")} />;
  return (
    <ul className="card-list card-grid">
      {batches.items.map((b) => (
        <Card as="li" key={b.id}>
          <div className="card-head">
            <strong>{b.name}</strong>
            <Badge tone="info">
              {b.memberCount}
              {b.capacity ? ` / ${b.capacity}` : ""} {t("data.members")}
            </Badge>
          </div>
          <div className="small muted">
            {b.sportName} · {b.venueName}
          </div>
          <div className="small">
            {b.schedule.length
              ? `${b.schedule.map((s) => weekday(locale, s.weekday)).join(", ")} · ${b.schedule[0].startTime}–${b.schedule[0].endTime}`
              : "–"}
          </div>
        </Card>
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
  // Recent sessions come newest first; the chart reads left to right in time.
  const chronological = [...recent.items].reverse();
  return (
    <>
      <StatGrid>
        <StatTile label={t("dash.members")} value={active} />
        <StatTile label={t("dash.batches")} value={batches} />
        <StatTile label={t("dash.overdue")} value={overdue} />
      </StatGrid>
      <SectionHeader title={t("dash.recent")} />
      {recent.items.length === 0 ? (
        <EmptyState title={t("data.empty")} />
      ) : (
        <>
          <Card title={t("dash.attendanceChart")}>
            <BarChart
              ariaLabel={t("dash.chartAria")}
              labels={chronological.map((s) => s.startsAt.slice(5, 10))}
              series={[
                { name: t("dash.seriesPresent"), values: chronological.map((s) => s.attendanceSummary?.present ?? null) },
                { name: t("dash.seriesMarked"), values: chronological.map((s) => s.attendanceSummary?.total ?? null), color: "var(--c2)" },
              ]}
            />
          </Card>
          <ul className="card-list">
            {recent.items.map((s) => (
              <Card as="li" key={s.id}>
                <div className="card-head">
                  <strong>{s.batchName}</strong>
                  <Badge tone={SESSION_TONE[s.status] ?? "neutral"}>{t(`status.${s.status}`)}</Badge>
                </div>
                <div className="small muted">
                  {s.startsAt.slice(0, 10)} · {s.coachName}
                </div>
                {s.attendanceSummary && (
                  <div className="small">
                    {t("dash.present", { present: s.attendanceSummary.present, total: s.attendanceSummary.total })}
                  </div>
                )}
              </Card>
            ))}
          </ul>
        </>
      )}
      <SectionHeader title={t("nav.coaches")} />
      <CoachesList />
    </>
  );
}

async function CoachesList() {
  const { t } = await getT();
  const { db } = await getViewer();
  const coaches = await db.user.findMany({
    where: { role: "COACH" },
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true, batches: { where: { isActive: true }, select: { name: true } } },
  });
  if (coaches.length === 0) return <EmptyState title={t("data.empty")} />;
  return (
    <ul className="card-list card-grid">
      {coaches.map((c) => (
        <Card as="li" key={c.id}>
          <div className="person">
            <Avatar name={c.name} />
            <strong>{c.name}</strong>
          </div>
          <div className="small muted">{c.email}</div>
          <div className="small">{c.batches.map((b) => b.name).join(", ") || "–"}</div>
        </Card>
      ))}
    </ul>
  );
}

export async function SettingsScreen() {
  const { t } = await getT();
  const { principal, db } = await getViewer();
  const theme = await getThemeForTenant(prisma, principal.tenantId);
  const row = await db.tenantTheme.findFirst({ select: { defaultLocale: true } });
  const swatch = (hex: string) => (
    <>
      <span className="swatch" style={{ background: hex }} aria-hidden="true" />
      {hex}
    </>
  );
  const rows: [string, ReactNode][] = [
    [t("settings.business"), theme.displayName],
    [t("settings.logo"), theme.logoUrl ?? "–"],
    [t("settings.primary"), swatch(theme.primaryColor)],
    [t("settings.secondary"), swatch(theme.secondaryColor)],
    [t("settings.accent"), theme.accentColor ? swatch(theme.accentColor) : "–"],
    [t("settings.language"), row?.defaultLocale ?? "en"],
  ];
  return (
    <>
      <ul className="card-list card-grid">
        {rows.map(([label, value], i) => (
          <Card as="li" key={i}>
            <span className="muted small">{label}</span>
            <div>{value}</div>
          </Card>
        ))}
      </ul>
      <p className="muted">{t("settings.readonly")}</p>
    </>
  );
}
