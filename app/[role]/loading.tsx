import { getT } from "@/lib/i18n/server";
import { PageSkeleton } from "@/components/ui/Skeleton";

/** Shown inside the shell while a role screen loads. */
export default async function Loading() {
  const { t } = await getT();
  return <PageSkeleton label={t("app.loading")} />;
}
