import Link from "next/link";
import { getT } from "@/lib/i18n/server";
import { homePath } from "@/lib/guard";
import type { Role } from "@/lib/nav";

export async function NotAllowed({ role }: { role: Role }) {
  const { t } = await getT();
  return (
    <section role="alert" className="card">
      <h1>{t("notAllowed.title")}</h1>
      <p>{t("notAllowed.body")}</p>
      <Link href={homePath(role)} className="btn">{t("notAllowed.back")}</Link>
    </section>
  );
}
