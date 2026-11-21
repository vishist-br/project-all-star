import Link from "next/link";
import { notFound } from "next/navigation";
import { getT } from "@/lib/i18n/server";
import { findNavItem, isRole } from "@/lib/nav";
import {
  BatchesScreen,
  DashboardScreen,
  MembersScreen,
  SettingsScreen,
} from "@/components/owner/OwnerScreens";
import { WorkoutsScreen, type WorkoutFilters } from "@/components/WorkoutsScreen";

// Owner screens show live data; coach and customer screens are still placeholders.
export default async function SectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ role: string; section: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { role, section } = await params;
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
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
      {section === "workouts" && (
        <WorkoutsScreen
          filters={{ q: one("q"), muscle: one("muscle"), equipment: one("equipment"), level: one("level"), sport: one("sport"), page: one("page") } satisfies WorkoutFilters}
        />
      )}
      {role === "owner" && section === "dashboard" && <DashboardScreen />}
      {role === "owner" && section === "members" && <MembersScreen />}
      {role === "owner" && section === "batches" && <BatchesScreen />}
      {role === "owner" && section === "settings" && <SettingsScreen />}
      {role !== "owner" && section !== "workouts" && <p className="muted">{t("shell.placeholder")}</p>}
    </section>
  );
}
