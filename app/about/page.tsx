import Link from "next/link";
import { getT } from "@/lib/i18n/server";
import { Footer } from "@/components/Footer";

// About Us is identical for every tenant: static i18n copy, no tenant values.
export default async function AboutPage() {
  const { t } = await getT();
  return (
    <>
      <main className="page-pad about">
        <h1>{t("about.title")}</h1>
        <p>{t("about.p1")}</p>
        <p>{t("about.p2")}</p>
        <p>{t("about.p3")}</p>
        <Link href="/" className="btn">{t("about.back")}</Link>
      </main>
      <Footer />
    </>
  );
}
