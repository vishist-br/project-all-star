"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteMeasurementAction } from "@/app/[role]/_actions/plans-library";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { useI18n } from "@/lib/i18n/client";

/** Delete one history entry, after a confirm step. `dateLabel` is the already formatted day. */
export function DeleteEntry({ memberId, measurementId, dateLabel }: { memberId: string; measurementId: string; dateLabel: string }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    const res = await deleteMeasurementAction(memberId, measurementId);
    setBusy(false);
    setOpen(false);
    if (res.ok) {
      toast(t("gx.bm.deleted"));
      router.refresh();
    } else toast(t("gx.bm.failed"), "danger");
  }

  return (
    <>
      <Button variant="ghost" disabled={busy} aria-label={`${t("gx.bm.delete")}: ${dateLabel}`} onClick={() => setOpen(true)}>{t("gx.bm.delete")}</Button>
      <ConfirmDialog
        open={open}
        title={t("gx.bm.deleteTitle")}
        text={t("gx.bm.deleteText", { date: dateLabel })}
        confirmLabel={t("gx.bm.delete")}
        cancelLabel={t("gx.pl.cancel")}
        danger
        onConfirm={() => void remove()}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
