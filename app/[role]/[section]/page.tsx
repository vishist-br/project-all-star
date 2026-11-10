import Link from "next/link";
import { notFound } from "next/navigation";
import { getT } from "@/lib/i18n/server";
import { findNavItem, isRole } from "@/lib/nav";
import {
  BatchesScreen,
  CoachesScreen,
  DashboardScreen,
  MembersScreen,
  SettingsScreen,
} from "@/components/owner/OwnerScreens";

// Owner screens show live data; coach and customer screens are still placeholders.
export default async function SectionPage({
  params,
}: {
  params: Promise<{ role: string; section: string }>;
}) {
  const { role, section } = await params;
  if (!isRole(role)) notFound();
  const item = findNavItem(role, section);
  if (!item) notFound();
  const { t } = await getT();
  return (
    <section>
      <h1>{t(item.label)}</h1>
      {role === "owner" && section === "members" && (
        <p>
          <Link href="/owner/members/import" className="btn">{t("import.title")}</Link>
        </p>
      )}
      {role === "owner" && section === "dashboard" && <DashboardScreen />}
      {role === "owner" && section === "members" && <MembersScreen />}
      {role === "owner" && section === "batches" && <BatchesScreen />}
      {role === "owner" && section === "coaches" && <CoachesScreen />}
      {role === "owner" && section === "settings" && <SettingsScreen />}
      {role !== "owner" && <p className="muted">{t("shell.placeholder")}</p>}
    </section>
  );
}
