import { notFound } from "next/navigation";
import { Roster } from "@/components/member/Roster";
import { isRole } from "@/lib/nav";

/** /coach/members (own batches) and /owner/members (everyone). The role layout already blocks other roles; a customer on /customer/members gets a 404. */
export default async function MembersPage({ params, searchParams }: { params: Promise<{ role: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { role } = await params;
  if (!isRole(role) || role === "customer") notFound();
  return <Roster role={role} searchParams={await searchParams} />;
}
