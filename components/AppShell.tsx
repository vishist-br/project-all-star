import type { ReactNode } from "react";
import { getT } from "@/lib/i18n/server";
import { NEEDS_REVIEW } from "@/lib/i18n";
import { NAV, type Role } from "@/lib/nav";
import { getSession } from "@/lib/session";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { NavLink } from "./NavLink";
import { Footer } from "./Footer";

/** Shell for the signed-in user's own role. Theme variables come from the document root. */
export async function AppShell({ role, children }: { role: Role; children: ReactNode }) {
  const { t, locale } = await getT();
  const { theme, name } = await getSession();

  return (
    <div className="shell">
      <header className="shell-header">
        {/* Only the business's own name/logo is shown. No builder branding. */}
        {theme.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={theme.logoUrl} alt="" width={32} height={32} className="logo-img" />
        ) : (
          <span className="logo-mark" aria-hidden="true">{theme.displayName.slice(0, 1)}</span>
        )}
        <div className="shell-title">
          <strong>{theme.displayName}</strong>
          <small>{t(`role.${role}`)} · {name}</small>
        </div>
        <LanguageSwitcher />
      </header>
      {NEEDS_REVIEW.includes(locale) && <p className="review-banner">{t("review.banner")}</p>}
      <main className="shell-main">{children}</main>
      <Footer />
      <nav className="shell-nav" aria-label={t("nav.label")}>
        {NAV[role].map((item) => (
          <NavLink key={item.section} href={`/${role}/${item.section}`} icon={item.icon}>
            {t(item.label)}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
