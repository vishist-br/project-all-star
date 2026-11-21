import { notFound, redirect } from "next/navigation";
import { getT } from "@/lib/i18n/server";
import { isRole } from "@/lib/nav";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/States";

// Placeholder home for each role. The layout guard has already ensured this is the user's own role.
export default async function RoleHome({ params }: { params: Promise<{ role: string }> }) {
  const { role } = await params;
  if (!isRole(role)) notFound();
  // The customer's home is a real screen (STAR-69); /customer lands there.
  if (role === "customer") redirect("/customer/home");
  const { t } = await getT();
  return (
    <section>
      <PageHeader title={t(`home.${role}.title`)} subtitle={t(`home.${role}.body`)} />
      <ul className="card-list card-grid">
        <Card as="li">{t(`home.${role}.item1`)}</Card>
        <Card as="li">{t(`home.${role}.item2`)}</Card>
        <Card as="li">{t(`home.${role}.item3`)}</Card>
      </ul>
      <EmptyState title={t("shell.placeholder")} />
    </section>
  );
}
