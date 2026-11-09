import Link from "next/link";
import { getT } from "@/lib/i18n/server";
import { getSession } from "@/lib/session";

/** Footer shows only the business's own name. No builder branding. */
export async function Footer() {
  const { t } = await getT();
  const { theme } = await getSession();
  return (
    <footer className="site-footer">
      <span>{t("footer.copyright", { business: theme.displayName })}</span>
      <Link href="/about">{t("footer.about")}</Link>
    </footer>
  );
}
