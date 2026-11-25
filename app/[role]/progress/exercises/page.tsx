import { notFound } from "next/navigation";
import { ExercisesOverview } from "@/components/exercise/ExercisesOverview";

export const dynamic = "force-dynamic";

/** Customer: every exercise logged so far, with the latest number and a trend. */
export default async function ExercisesPage({ params }: { params: Promise<{ role: string }> }) {
  const { role } = await params;
  if (role !== "customer") notFound();
  return <ExercisesOverview />;
}
