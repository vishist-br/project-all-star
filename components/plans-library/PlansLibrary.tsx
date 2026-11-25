import Link from "next/link";
import { PlanActions } from "@/components/plans/PlanActions";
import s from "@/components/plans/plans.module.css";
import { PlanSendLinks } from "@/components/send/SendLinks";
import { Badge, type Tone } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { MessageKey } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { FolderActions } from "./FolderActions";
import { NewFolderForm } from "./NewFolderForm";
import { PlanLibraryActions, type FolderOption } from "./PlanLibraryActions";
import l from "./library.module.css";

const TONE: Record<string, Tone> = { draft: "neutral", active: "ok", archived: "warn" };

export type LibraryPlan = {
  id: string;
  title: string;
  cadence: string;
  status: string;
  folderId: string | null;
  isTemplate: boolean;
  coachName: string;
  itemCount: number;
  dayCount: number;
  activeAssignmentCount: number;
  updatedAt: string;
};
export type LibraryFolder = { id: string; name: string; coachName: string; planCount: number };

/** One plan (or template) card: the existing row actions plus Duplicate, Move to folder and Save as template. */
async function PlanCard({ role, plan, folders }: { role: string; plan: LibraryPlan; folders: FolderOption[] }) {
  const { t, locale } = await getT();
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale === "en" ? "en-IN" : locale, { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
  return (
    <Card as="li" className={s.planCard}>
      <div data-testid="plan-card" data-plan-title={plan.title} style={{ display: "contents" }}>
        <div className={s.planTop}>
          <h3 className={s.planTitle}>
            {plan.status === "archived" ? plan.title : <Link href={`/${role}/plans/${plan.id}`}>{plan.title}</Link>}
          </h3>
          <div className={s.chips}>
            {plan.isTemplate && <Badge tone="info">{t("gx.pl.templateBadge")}</Badge>}
            <Badge tone={TONE[plan.status] ?? "neutral"}>{t(`plans.status.${plan.status}` as MessageKey)}</Badge>
            <Badge tone="info">{t(`plans.cadence.${plan.cadence}` as MessageKey)}</Badge>
          </div>
        </div>
        <p className={s.meta}>
          {[
            t("plans.exercisesCount", { n: plan.itemCount }),
            t("plans.daysCount", { n: plan.dayCount }),
            plan.isTemplate ? null : t("plans.assigneesCount", { n: plan.activeAssignmentCount }),
            role === "owner" ? t("plans.by", { coach: plan.coachName }) : null,
            t("plans.updated", { date: date(plan.updatedAt) }),
          ].filter(Boolean).join(" · ")}
        </p>
        {plan.isTemplate ? (
          <div className={s.rowActions}>
            <ButtonLink variant="secondary" href={`/${role}/plans/${plan.id}`}>{t("plans.edit")}</ButtonLink>
          </div>
        ) : (
          <>
            <PlanActions role={role} plan={{ id: plan.id, title: plan.title, status: plan.status }} />
            {plan.status !== "archived" && <PlanSendLinks role={role} plan={{ id: plan.id, title: plan.title, status: plan.status }} />}
          </>
        )}
        {plan.status !== "archived" && <PlanLibraryActions role={role} plan={{ id: plan.id, title: plan.title, folderId: plan.folderId, isTemplate: plan.isTemplate }} folders={folders} />}
      </div>
    </Card>
  );
}

/**
 * The plans list as a library: folders are collapsible groups (plans on this page grouped by folder),
 * plans outside any folder come next, then a Templates section. Everything else about a plan row stays
 * as it was.
 */
export async function PlansLibrary({
  role,
  plans,
  folders,
  templates,
}: {
  role: string;
  plans: LibraryPlan[];
  folders: LibraryFolder[];
  templates: LibraryPlan[];
}) {
  const { t } = await getT();
  const options: FolderOption[] = folders.map((f) => ({ id: f.id, name: f.name, ...(role === "owner" ? { coachName: f.coachName } : {}) }));
  const byFolder = new Map<string, LibraryPlan[]>();
  const loose: LibraryPlan[] = [];
  const known = new Set(folders.map((f) => f.id));
  for (const p of plans) {
    if (p.folderId && known.has(p.folderId)) byFolder.set(p.folderId, [...(byFolder.get(p.folderId) ?? []), p]);
    else loose.push(p);
  }

  return (
    <div className={l.groups}>
      <NewFolderForm />
      {folders.map((f) => (
        <details key={f.id} className={l.group} open data-testid="folder-group" data-folder={f.name}>
          <summary className={l.summary}>
            <span>{f.name}</span>
            <span className={l.count}>{t("gx.pl.inFolder", { n: f.planCount })}</span>
            {role === "owner" && <span className={l.owner}>{t("gx.pl.folderOf", { coach: f.coachName })}</span>}
          </summary>
          <div className={l.groupBody}>
            <FolderActions folderId={f.id} name={f.name} />
            {(byFolder.get(f.id) ?? []).length === 0 ? (
              <p className={l.hint}>{t("gx.pl.folderEmpty")}</p>
            ) : (
              <ul className={l.list} aria-label={f.name}>
                {(byFolder.get(f.id) ?? []).map((p) => <PlanCard key={p.id} role={role} plan={p} folders={options} />)}
              </ul>
            )}
          </div>
        </details>
      ))}

      {loose.length > 0 && (
        <details className={l.group} open data-testid="folder-group" data-folder="none">
          <summary className={l.summary}>
            <span>{folders.length > 0 ? t("gx.pl.noFolder") : t("plans.title")}</span>
          </summary>
          <div className={l.groupBody}>
            <ul className={l.list} aria-label={t("plans.title")}>
              {loose.map((p) => <PlanCard key={p.id} role={role} plan={p} folders={options} />)}
            </ul>
          </div>
        </details>
      )}

      <details className={l.group} open data-testid="templates-section">
        <summary className={l.summary}>
          <span>{t("gx.pl.templates")}</span>
          <span className={l.count}>{templates.length}</span>
        </summary>
        <div className={l.groupBody}>
          <p className={l.hint}>{t("gx.pl.templatesHint")}</p>
          {templates.length === 0 ? (
            <p className={l.hint}>{t("gx.pl.templatesEmpty")}</p>
          ) : (
            <ul className={l.list} aria-label={t("gx.pl.templates")}>
              {templates.map((p) => <PlanCard key={p.id} role={role} plan={p} folders={options} />)}
            </ul>
          )}
        </div>
      </details>
    </div>
  );
}
