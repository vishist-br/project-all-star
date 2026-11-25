"use client";
import { ButtonLink } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/States";
import { useI18n } from "@/lib/i18n/client";

/** A read failed (often a bad connection): say logged sets are safe, offer a retry and the way back. */
export default function LiveError({ reset }: { error: Error; reset: () => void }) {
  const { t } = useI18n();
  return (
    <div className="stack">
      <ErrorState title={t("lw.err.title")} message={t("lw.err.body")} retryLabel={t("ui.retry")} onRetry={reset} />
      <ButtonLink href="/customer/workouts" variant="ghost">{t("lw.back")}</ButtonLink>
    </div>
  );
}
