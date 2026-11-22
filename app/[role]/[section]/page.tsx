import { notFound } from "next/navigation";
import { getT } from "@/lib/i18n/server";
import { findNavItem, isRole } from "@/lib/nav";
import { PageHeader } from "@/components/ui/PageHeader";
import { WorkoutsScreen, type WorkoutFilters } from "@/components/WorkoutsScreen";

// Only the exercise catalog lives here; every other section has its own route, so unknown sections 404.
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
  if (!item || item.section !== "workouts") notFound();
  const { t } = await getT();
  return (
    <section>
      <PageHeader title={t(item.label)} />
      <WorkoutsScreen
          filters={{ q: one("q"), muscle: one("muscle"), equipment: one("equipment"), level: one("level"), sport: one("sport"), page: one("page") } satisfies WorkoutFilters}
      />
    </section>
  );
}
