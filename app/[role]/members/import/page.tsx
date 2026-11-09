import { notFound } from "next/navigation";
import { ImportMembers } from "@/components/ImportMembers";
import { getT } from "@/lib/i18n/server";

// Owner only. (The [role] layout already blocks other roles from the owner URL; the other
// roles' URLs do not exist for this screen.)
export default async function ImportPage({ params }: { params: Promise<{ role: string }> }) {
  const { role } = await params;
  if (role !== "owner") notFound();
  const { t } = await getT();
  return (
    <section>
      <h1>{t("import.title")}</h1>
      <ImportMembers />
    </section>
  );
}
