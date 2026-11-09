import Link from "next/link";
import { getT } from "@/lib/i18n/server";
import { NEEDS_REVIEW } from "@/lib/i18n";
import { getSession } from "@/lib/session";
import { homePath } from "@/lib/guard";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Footer } from "@/components/Footer";

// Placeholder landing until sign-in (magic link / OTP) is built. Leads to the signed-in user's own home only.
export default async function Home() {
  const { t, locale } = await getT();
  const { theme, role } = await getSession();
  return (
    <>
      <main>
        {NEEDS_REVIEW.includes(locale) && <p className="review-banner">{t("review.banner")}</p>}
        <div className="page-pad">
          <LanguageSwitcher />
          {theme.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={theme.logoUrl} alt="" width={56} height={56} className="logo-img" />
          )}
          <h1>{t("home.title", { business: theme.displayName })}</h1>
          <p>{t("home.tagline")}</p>
          <Link href={homePath(role)} className="btn">{t("home.continue", { role: t(`role.${role}`) })}</Link>
        </div>
      </main>
      <Footer />
    </>
  );
}
