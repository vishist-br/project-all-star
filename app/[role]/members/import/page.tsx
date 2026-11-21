import { ImportMembers } from "@/components/ImportMembers";
import { NotAllowed } from "@/components/NotAllowed";
import { PageHeader } from "@/components/ui/PageHeader";
import { getT } from "@/lib/i18n/server";
import { isRole } from "@/lib/nav";
import { getSession } from "@/lib/session";
import { notFound } from "next/navigation";

// Owner only. The [role] layout already shows the not-allowed view when a coach or customer opens
// the owner URL; a coach or customer URL for this screen shows it too. The bridge route
// (app/ui/members-import) enforces the owner role again on the server.
export default async function ImportPage({ params }: { params: Promise<{ role: string }> }) {
  const { role } = await params;
  if (!isRole(role)) notFound();
  if (role !== "owner") return <NotAllowed role={role} />;
  const { t } = await getT();
  const session = await getSession();
  return (
    <section>
      <PageHeader title={t("import.title")} subtitle={t("imp.subtitle")} />
      <ImportMembers demo={session.source === "demo"} />
    </section>
  );
}
