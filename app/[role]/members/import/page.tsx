import { notFound } from "next/navigation";
import { ImportMembers } from "@/components/ImportMembers";
import { getT } from "@/lib/i18n/server";
import { getSession } from "@/lib/session";

// Owner only. (The [role] layout already blocks other roles from the owner URL; the other
// roles' URLs do not exist for this screen.)
export default async function ImportPage({ params }: { params: Promise<{ role: string }> }) {
  const { role } = await params;
  if (role !== "owner") notFound();
  const { t } = await getT();
  const session = await getSession();
  return (
    <section>
      <h1>{t("import.title")}</h1>
      <ImportMembers live={session.source === "real"} />
    </section>
  );
}
