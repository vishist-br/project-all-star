import { notFound } from "next/navigation";
import { CoachRecord } from "@/components/coach/record/CoachRecord";
import { parsePeriod } from "@/lib/members/view";
import { isRole } from "@/lib/nav";
import { getViewer } from "@/lib/viewer";

/** /coach/record: the signed-in coach's own record of delivered sessions. Other roles are blocked by the role layout; others get a 404. */
export default async function RecordPage({ params, searchParams }: { params: Promise<{ role: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { role } = await params;
  if (!isRole(role) || role !== "coach") notFound();
  const sp = await searchParams;
  const { principal } = await getViewer();
  if (principal.role !== "coach") notFound();
  return <CoachRecord coachId={principal.userId} basePath="/coach/record" days={parsePeriod(sp.days)} />;
}
