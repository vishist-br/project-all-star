import { notFound } from "next/navigation";
import { MemberDetail } from "@/components/member/MemberDetail";
import { isRole } from "@/lib/nav";
import { parsePeriod } from "@/lib/members/view";

/**
 * /coach/members/[memberId] (own members) and /owner/members/[memberId] (all). Another business's
 * id is a 404; another coach's member shows a friendly "not one of yours" notice; a customer never
 * reaches this page (the role layout and the check below).
 */
export default async function MemberPage({ params, searchParams }: { params: Promise<{ role: string; memberId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { role, memberId } = await params;
  if (!isRole(role) || role === "customer") notFound();
  const sp = await searchParams;
  return <MemberDetail role={role} memberId={memberId} days={parsePeriod(sp.days)} />;
}
