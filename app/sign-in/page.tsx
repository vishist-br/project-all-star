import { getT } from "@/lib/i18n/server";
import { NEEDS_REVIEW } from "@/lib/i18n";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Footer } from "@/components/Footer";

// Shown when there is no session. Sign-in is by magic link only, so this page explains where to find it.
export default async function SignInNeededPage() {
  const { t, locale } = await getT();
  return (
    <>
      <main>
        {NEEDS_REVIEW.includes(locale) && <p className="review-banner">{t("review.banner")}</p>}
        <div className="page-pad auth-card">
          <LanguageSwitcher />
          <h1>{t("signin.needed.title")}</h1>
          <p>{t("signin.needed.body")}</p>
        </div>
      </main>
      <Footer />
    </>
  );
}
