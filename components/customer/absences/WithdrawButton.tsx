"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { withdrawAbsenceAction } from "@/app/[role]/_actions/absences";
import { Button, useToast } from "@/components/ui";
import { useI18n } from "@/lib/i18n/client";

/** Take back a declared absence (before it has happened). */
export function WithdrawButton({ absenceId }: { absenceId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="secondary"
      loading={pending}
      onClick={() =>
        start(async () => {
          const res = await withdrawAbsenceAction(absenceId);
          toast(res.ok ? t("abs.toast.withdrawn") : t("abs.err.other"), res.ok ? "ok" : "warn");
          router.refresh();
        })
      }
    >
      {t("abs.withdraw")}
    </Button>
  );
}
