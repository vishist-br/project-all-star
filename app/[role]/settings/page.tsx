import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { BookingRulesForm } from "@/components/owner/settings/BookingRulesForm";
import s from "@/components/owner/settings/settings.module.css";
import { NotAllowed } from "@/components/NotAllowed";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { loadTenantSettings } from "@/lib/api/tenant-settings";
import { checkRole } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { isRole } from "@/lib/nav";
import { getThemeForTenant } from "@/lib/theme";
import { getViewer } from "@/lib/viewer";

/** Owner settings: brand (read-only) and editable booking rules. Owner only. */
export default async function SettingsPage({ params }: { params: Promise<{ role: string }> }) {
  const { role } = await params;
  if (!isRole(role)) notFound();
  const { t } = await getT();
  const { principal, db } = await getViewer();
  if (principal.role !== "owner" || role !== "owner") return <NotAllowed role={principal.role} />;
  checkRole(principal, "updateTenantSettings");

  const [theme, rules, row] = await Promise.all([
    getThemeForTenant(prisma, principal.tenantId),
    loadTenantSettings(db),
    db.tenantTheme.findFirst({ select: { defaultLocale: true } }),
  ]);
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
    <section>
      <PageHeader title={t("nav.settings")} />
      <div className={s.grid}>
        <BookingRulesForm initial={rules} />
        <Card title={t("set.brand.title")}>
          <ul className={s.brand}>
            {rows.map(([label, value], i) => (
              <li key={i}>
                <span className="muted small">{label}</span>
                <span>{value}</span>
              </li>
            ))}
          </ul>
          <p className="muted small">{t("settings.readonly")}</p>
        </Card>
      </div>
      <nav className={s.links} aria-label={t("set.links.title")}>
        <ButtonLink variant="secondary" href="/owner/coaches">{t("set.links.coaches")}</ButtonLink>
        <ButtonLink variant="secondary" href="/owner/holidays">{t("set.links.holidays")}</ButtonLink>
        <ButtonLink variant="secondary" href="/owner/workouts">{t("set.links.library")}</ButtonLink>
      </nav>
    </section>
  );
}
