import { notFound } from "next/navigation";
import { ExerciseScreen } from "@/components/exercise/ExerciseScreen";
import { isRole } from "@/lib/nav";

export const dynamic = "force-dynamic";

/**
 * Exercise detail with Progress, History and How to tabs (URL-driven: ?tab=history&range=1y&metric=oneRepMax).
 * Customers see their own (or the selected child's) data; coach and owner choose a member (?memberId=).
 */
export default async function ExerciseDetail({
  params,
  searchParams,
}: {
  params: Promise<{ role: string; exerciseId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { role, exerciseId } = await params;
  if (!isRole(role)) notFound();
  return <ExerciseScreen role={role} exerciseId={exerciseId} search={await searchParams} />;
}
