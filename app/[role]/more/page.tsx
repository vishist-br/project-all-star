import Link from "next/link";
import { notFound } from "next/navigation";
import { getT } from "@/lib/i18n/server";
import { NAV, isRole } from "@/lib/nav";

/** Every screen of the role, for phones where the bottom bar has room for only four. */
export default async function MorePage({ params }: { params: Promise<{ role: string }> }) {
  const { role } = await params;
  if (!isRole(role)) notFound();
  const { t } = await getT();
  return (
    <div className="page-pad">
      <h1>{t("nav.more")}</h1>
      <ul className="more-list">
        {NAV[role].map((item) => (
          <li key={item.section}>
            <Link href={`/${role}/${item.section}`}>
              <span aria-hidden="true">{item.icon}</span>
              <span>{t(item.label)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
