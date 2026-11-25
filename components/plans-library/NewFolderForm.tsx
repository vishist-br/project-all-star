"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createFolderAction } from "@/app/[role]/_actions/plans-library";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/Form";
import { useToast } from "@/components/ui/Toast";
import { useI18n } from "@/lib/i18n/client";
import s from "./library.module.css";

/** One line to add a folder: a name and a button. */
export function NewFolderForm() {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const clean = name.trim();
    if (clean.length < 1 || clean.length > 60) return setErr(t("gx.pl.nameErr"));
    setErr(null);
    setBusy(true);
    const res = await createFolderAction(clean);
    setBusy(false);
    if (res.ok) {
      setName("");
      toast(t("gx.pl.created"));
      router.refresh();
    } else setErr(res.code === "conflict" ? t("gx.pl.nameClash") : res.code === "validation_failed" ? t("gx.pl.nameErr") : t("gx.pl.folderFail"));
  }

  return (
    <form className={s.newFolder} onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate aria-label={t("gx.pl.newFolder")}>
      <div className="field">
        <label className="field-label" htmlFor="nf-name">{t("gx.pl.folderName")}</label>
        <TextInput id="nf-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" maxLength={60} aria-invalid={err ? true : undefined} aria-describedby={err ? "nf-err" : undefined} />
        {err && <p id="nf-err" className="field-error" role="alert">{err}</p>}
      </div>
      <Button type="submit" variant="secondary" loading={busy}>{t("gx.pl.addFolder")}</Button>
    </form>
  );
}
