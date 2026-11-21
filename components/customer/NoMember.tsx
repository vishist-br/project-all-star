import { getT } from "@/lib/i18n/server";
import { PageHeader } from "@/components/ui";

/** A customer sign-in with no member profile linked yet. */
export async function NoMember() {
  const { t } = await getT();
  return <PageHeader title={t("cu.nomember.title")} subtitle={t("cu.nomember.body")} />;
}
