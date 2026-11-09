import { notFound } from "next/navigation";
import { getT } from "@/lib/i18n/server";
import { findNavItem, isRole } from "@/lib/nav";

// Placeholder screen. Real content arrives with each feature task.
export default async function SectionPage({
  params,
}: {
  params: Promise<{ role: string; section: string }>;
}) {
  const { role, section } = await params;
  if (!isRole(role)) notFound();
  const item = findNavItem(role, section);
  if (!item) notFound();
  const { t } = await getT();
  return (
    <section>
      <h1>{t(item.label)}</h1>
      <p className="muted">{t("shell.placeholder")}</p>
    </section>
  );
}
