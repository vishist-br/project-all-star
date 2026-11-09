import { notFound } from "next/navigation";
import { getT } from "@/lib/i18n/server";
import { isRole } from "@/lib/nav";

// Placeholder home for each role. The layout guard has already ensured this is the user's own role.
export default async function RoleHome({ params }: { params: Promise<{ role: string }> }) {
  const { role } = await params;
  if (!isRole(role)) notFound();
  const { t } = await getT();
  return (
    <section>
      <h1>{t(`home.${role}.title`)}</h1>
      <p>{t(`home.${role}.body`)}</p>
      <ul className="card-list">
        <li className="card">{t(`home.${role}.item1`)}</li>
        <li className="card">{t(`home.${role}.item2`)}</li>
        <li className="card">{t(`home.${role}.item3`)}</li>
      </ul>
      <p className="muted">{t("shell.placeholder")}</p>
    </section>
  );
}
