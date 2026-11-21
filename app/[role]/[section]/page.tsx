import { notFound } from "next/navigation";
import { getT } from "@/lib/i18n/server";
import { findNavItem, isRole } from "@/lib/nav";
import { MembersScreen } from "@/components/owner/OwnerScreens";
import { ButtonLink } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/States";
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
      <PageHeader
        title={t(item.label)}
        actions={
          role === "owner" && section === "members" ? <ButtonLink href="/owner/members/import">{t("import.title")}</ButtonLink> : undefined
        }
      />
      {section === "workouts" && (
        <WorkoutsScreen
          filters={{ q: one("q"), muscle: one("muscle"), equipment: one("equipment"), level: one("level"), sport: one("sport"), page: one("page") } satisfies WorkoutFilters}
        />
      )}
      {role === "owner" && section === "members" && <MembersScreen />}
      {!(role === "owner" && section === "members") && section !== "workouts" && <EmptyState title={t("shell.placeholder")} />}
    </section>
  );
}
