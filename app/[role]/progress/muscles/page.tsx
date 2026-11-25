import { notFound } from "next/navigation";
import { MuscleVolumeScreen } from "@/components/muscle-volume/MuscleVolumeScreen";

export const dynamic = "force-dynamic";

/** Customer: sets and volume for every muscle group, this week or the last four weeks. Reached from Progress. */
export default async function MusclesPage({
  params,
  searchParams,
}: {
  params: Promise<{ role: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { role } = await params;
  if (role !== "customer") notFound();
  return <MuscleVolumeScreen searchParams={await searchParams} />;
}
