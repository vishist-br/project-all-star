"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteFolderAction, renameFolderAction } from "@/app/[role]/_actions/plans-library";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/Form";
import { ConfirmDialog, Sheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { useI18n } from "@/lib/i18n/client";
import s from "./library.module.css";

/** Rename and delete for one folder (delete keeps the plans). */
export function FolderActions({ folderId, name }: { folderId: string; name: string }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [value, setValue] = useState(name);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function rename() {
    const clean = value.trim();
    if (clean.length < 1 || clean.length > 60) return setErr(t("gx.pl.nameErr"));
    setBusy(true);
    const res = await renameFolderAction(folderId, clean);
    setBusy(false);
    if (res.ok) {
      setRenameOpen(false);
      toast(t("gx.pl.renamed"));
      router.refresh();
    } else setErr(res.code === "conflict" ? t("gx.pl.nameClash") : t("gx.pl.folderFail"));
  }

  async function remove() {
    setBusy(true);
    const res = await deleteFolderAction(folderId);
    setBusy(false);
    setDeleteOpen(false);
    if (res.ok) {
      toast(t("gx.pl.deleted"));
      router.refresh();
    } else toast(t("gx.pl.actionFail"), "danger");
  }

  return (
    <div className={s.folderTools}>
      <Button variant="ghost" aria-label={`${t("gx.pl.rename")}: ${name}`} onClick={() => { setValue(name); setErr(null); setRenameOpen(true); }}>{t("gx.pl.rename")}</Button>
      <Button variant="ghost" aria-label={`${t("gx.pl.deleteFolder")}: ${name}`} onClick={() => setDeleteOpen(true)}>{t("gx.pl.deleteFolder")}</Button>
      <Sheet open={renameOpen} title={t("gx.pl.renameTitle")} closeLabel={t("gx.pl.close")} onClose={() => setRenameOpen(false)}>
        <form className={s.sheetBody} onSubmit={(e) => { e.preventDefault(); void rename(); }} noValidate>
          <div className="field">
            <label className="field-label" htmlFor={`rn-${folderId}`}>{t("gx.pl.folderName")}</label>
            <TextInput id={`rn-${folderId}`} value={value} onChange={(e) => setValue(e.target.value)} maxLength={60} autoComplete="off" aria-invalid={err ? true : undefined} />
            {err && <p className="field-error" role="alert">{err}</p>}
          </div>
          <div className="actions"><Button type="submit" loading={busy}>{t("gx.pl.save")}</Button></div>
        </form>
      </Sheet>
      <ConfirmDialog
        open={deleteOpen}
        title={t("gx.pl.deleteTitle")}
        text={t("gx.pl.deleteText")}
        confirmLabel={t("gx.pl.deleteFolder")}
        cancelLabel={t("gx.pl.cancel")}
        danger
        onConfirm={() => void remove()}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  );
}
