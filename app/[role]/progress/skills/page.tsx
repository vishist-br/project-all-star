import { notFound } from "next/navigation";
import { SkillsScreen } from "@/components/skills/SkillsScreen";

export const dynamic = "force-dynamic";

/** Customer: belts and skills in full. */
export default async function SkillsPage({ params }: { params: Promise<{ role: string }> }) {
  const { role } = await params;
  if (role !== "customer") notFound();
  return <SkillsScreen />;
}
