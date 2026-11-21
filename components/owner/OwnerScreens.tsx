import { listBatches } from "@/lib/api/batches";
import { listMembers } from "@/lib/api/members";
import { getT } from "@/lib/i18n/server";
import { getViewer } from "@/lib/viewer";
import { Badge, type Tone } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/States";

const LIMIT = new URLSearchParams({ limit: "100" });

const FEE_TONE: Record<string, Tone> = { paid: "ok", due: "warn", overdue: "danger" };

/** Members list (replaced by the STAR-71 members screens later). Dashboard, coaches, batches and settings have their own routes. */
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
