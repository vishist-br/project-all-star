"use client";
import { ErrorState } from "@/components/ui/States";
import { useI18n } from "@/lib/i18n/client";

/** Error boundary for every role screen, inside the shell. `reset` re-renders the failed segment. */
export default function RoleError({ reset }: { error: Error; reset: () => void }) {
  const { t } = useI18n();
  return <ErrorState title={t("ui.errorTitle")} message={t("ui.errorBody")} retryLabel={t("ui.retry")} onRetry={reset} />;
}
