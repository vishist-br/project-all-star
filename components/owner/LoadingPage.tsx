import { getT } from "@/lib/i18n/server";
import { Skeleton } from "@/components/ui/Skeleton";

/** Shared loading skeleton for the owner coaches, settings and batches pages. */
export async function LoadingPage({ cards = 3 }: { cards?: number }) {
  const { t } = await getT();
  return (
    <div role="status" aria-busy="true" aria-label={t("app.loading")}>
      <div className="skeleton skel-title" aria-hidden="true" />
      {Array.from({ length: cards }, (_, i) => (
        <Skeleton key={i} kind="tile" />
      ))}
    </div>
  );
}
