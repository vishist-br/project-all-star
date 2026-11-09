import { getT } from "@/lib/i18n/server";
import { NEEDS_REVIEW } from "@/lib/i18n";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export default async function Home() {
  const { t, locale } = await getT();
  return (
    <main>
      {NEEDS_REVIEW.includes(locale) && <p className="review-banner">{t("review.banner")}</p>}
      <div style={{ padding: "1rem" }}>
        <LanguageSwitcher />
        <h1>{t("home.title", { business: "Demo Academy" })}</h1>
        <p>{t("home.tagline")}</p>
      </div>
    </main>
  );
}
