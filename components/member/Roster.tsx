import Link from "next/link";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { Select, TextInput } from "@/components/ui/Form";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { getT } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n";
import { loadRoster } from "@/lib/members/server";
import { parseRosterFilters, percentText } from "@/lib/members/view";
import { getViewer } from "@/lib/viewer";
import s from "./member.module.css";

const FEE_TONE: Record<string, Tone> = { paid: "ok", due: "warn", overdue: "danger" };
type Search = Record<string, string | string[] | undefined>;

/** Members roster for the coach (own batches) and the owner (everyone). Reads through the same lib/api functions as the API. */
export async function Roster({ role, searchParams }: { role: "coach" | "owner"; searchParams: Search }) {
  const { t } = await getT();
  const filters = parseRosterFilters(searchParams);
  const { db, principal } = await getViewer();
  const filtered = Boolean(filters.q || filters.batchId || filters.checkIn || filters.status !== "active");

  let data: Awaited<ReturnType<typeof loadRoster>> | null = null;
  try {
    data = await loadRoster(db, principal, filters);
  } catch (err) {
    console.error("roster failed", err);
  }

  const notEnough = t("roster.notEnough");
  return (
    <>
      <PageHeader
        title={t("nav.members")}
        subtitle={role === "owner" ? t("roster.subtitleOwner") : t("roster.subtitle")}
        actions={role === "owner" ? <ButtonLink href="/owner/members/import">{t("import.title")}</ButtonLink> : undefined}
      />
      <form method="get" className={s.toolbar} role="search" aria-label={t("roster.search")}>
        <div className="field">
          <label className="field-label" htmlFor="rs-q">{t("roster.search")}</label>
          <TextInput id="rs-q" type="search" name="q" defaultValue={filters.q} autoComplete="off" />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="rs-batch">{t("roster.batch")}</label>
          <Select id="rs-batch" name="batchId" defaultValue={filters.batchId}>
            <option value="">{t("roster.allBatches")}</option>
            {(data?.batches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="rs-status">{t("roster.status")}</label>
          <Select id="rs-status" name="status" defaultValue={filters.status}>
            {(["active", "ended", "all"] as const).map((v) => <option key={v} value={v}>{t(`roster.status.${v}` as MessageKey)}</option>)}
          </Select>
        </div>
        <label className={s.check}>
          <input type="checkbox" name="checkin" value="1" defaultChecked={filters.checkIn} />
          <span>{t("roster.checkinOnly")}</span>
        </label>
        <Button type="submit">{t("roster.show")}</Button>
      </form>

      {!data && <ErrorState title={t("ui.errorTitle")} message={t("roster.loadError")} />}
      {data && data.flagged > 0 && !filters.checkIn && (
        <p className={s.banner} role="status">{t("roster.flagged", { n: data.flagged })}</p>
      )}
      {data && data.rows.length === 0 &&
        (filtered ? (
          <EmptyState title={t("roster.empty.filtered")} />
        ) : (
          <EmptyState
            title={t("roster.empty.title")}
            text={t("roster.empty.text")}
            action={role === "owner" ? <ButtonLink href="/owner/members/import">{t("import.title")}</ButtonLink> : undefined}
          />
        ))}
      {data && data.rows.length > 0 && (
        <DataTable
          caption={t("nav.members")}
          rows={data.rows}
          rowKey={(m) => m.id}
          columns={[
            {
              key: "name",
              header: t("data.name"),
              render: (m) => (
                <>
                  <Link className={s.nameLink} href={`/${role}/members/${m.id}`} aria-label={t("roster.open", { name: m.name })}>{m.name}</Link>
                  {m.reasons.length > 0 && (
                    <div className={s.chips}>
                      <Badge tone="info">{t("roster.checkin")}</Badge>
                      <span className={s.reasons}>{m.reasons.map((r) => t(`roster.checkin.${r}` as MessageKey)).join(" · ")}</span>
                    </div>
                  )}
                </>
              ),
            },
            { key: "batch", header: t("data.batch"), render: (m) => m.batchNames.join(", ") || "–" },
            { key: "level", header: t("data.level"), render: (m) => m.level ?? "–" },
            { key: "att", header: t("data.attendance"), align: "end", render: (m) => percentText(m.attendancePercent, notEnough) },
            { key: "adh", header: t("roster.col.adherence"), align: "end", render: (m) => percentText(m.adherencePercent, notEnough) },
            { key: "plan", header: t("roster.col.plan"), render: (m) => m.activePlan ?? t("roster.noPlan") },
            { key: "fee", header: t("data.fee"), render: (m) => (m.feeStatus ? <Badge tone={FEE_TONE[m.feeStatus] ?? "neutral"}>{t(`fee.${m.feeStatus}` as MessageKey)}</Badge> : "–") },
          ]}
        />
      )}
      {data && <p className={s.note}>{t("roster.window")}</p>}
      {data?.more && <p className={s.note}>{t("roster.more")}</p>}
    </>
  );
}
