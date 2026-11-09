import Link from "next/link";
import { getT } from "@/lib/i18n/server";
import { NEEDS_REVIEW } from "@/lib/i18n";
import { ROLES } from "@/lib/nav";
import { MOCK_THEME } from "@/lib/mock-session";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

// Placeholder role picker until sign-in (magic link / OTP) is built.
export default async function Home() {
  const { t, locale } = await getT();
  return (
    <main>
      {NEEDS_REVIEW.includes(locale) && <p className="review-banner">{t("review.banner")}</p>}
      <div className="page-pad">
        <LanguageSwitcher />
        <h1>{t("home.title", { business: MOCK_THEME.displayName })}</h1>
        <p>{t("home.tagline")}</p>
        <p className="muted">{t("home.pickRole")}</p>
        <ul className="role-list">
          {ROLES.map((r) => (
            <li key={r}>
              <Link href={`/${r}`} className="btn">{t(`role.${r}`)}</Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
