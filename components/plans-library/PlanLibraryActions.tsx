"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { duplicatePlanAction, movePlanAction } from "@/app/[role]/_actions/plans-library";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Form";
import { Sheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { useI18n } from "@/lib/i18n/client";
import s from "./library.module.css";

export type FolderOption = { id: string; name: string; coachName?: string };

/**
 * Library actions of one plan row: Duplicate, Move to folder and Save as template (plans), or
 * Use template and Duplicate (templates). "Use template" makes a new plan and opens the builder.
 */
export function PlanLibraryActions({
  role,
  plan,
  folders,
}: {
  role: string;
  plan: { id: string; title: string; folderId: string | null; isTemplate: boolean };
  folders: FolderOption[];
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [target, setTarget] = useState(plan.folderId ?? "");

  async function copy(kind: "duplicate" | "template" | "use") {
    setBusy(kind);
    const res = await duplicatePlanAction(plan.id, { asTemplate: kind === "template" });
    setBusy(null);
    if (!res.ok) return toast(t("gx.pl.actionFail"), "danger");
    if (kind === "use") {
      toast(t("gx.pl.templateUsed"));
      router.push(`/${role}/plans/${res.data.id}`);
      return;
    }
    toast(kind === "template" ? t("gx.pl.templateSaved") : t("gx.pl.duplicated"));
    router.refresh();
  }

  async function move() {
    setBusy("move");
    const res = await movePlanAction(plan.id, target || null);
    setBusy(null);
    if (!res.ok) return toast(t("gx.pl.actionFail"), "danger");
    setMoveOpen(false);
    toast(t("gx.pl.moved"));
    router.refresh();
  }

  const label = (key: "gx.pl.duplicate" | "gx.pl.saveTemplate" | "gx.pl.useTemplate" | "gx.pl.move") => `${t(key)}: ${plan.title}`;

  return (
    <div className={s.actions} role="group" aria-label={t("gx.pl.groupLabel", { plan: plan.title })}>
      {plan.isTemplate && (
        <Button loading={busy === "use"} disabled={busy !== null} aria-label={label("gx.pl.useTemplate")} onClick={() => void copy("use")}>{t("gx.pl.useTemplate")}</Button>
      )}
      <Button variant="secondary" loading={busy === "duplicate"} disabled={busy !== null} aria-label={label("gx.pl.duplicate")} onClick={() => void copy("duplicate")}>{t("gx.pl.duplicate")}</Button>
      {!plan.isTemplate && (
        <>
          <Button variant="secondary" disabled={busy !== null} aria-label={label("gx.pl.move")} onClick={() => { setTarget(plan.folderId ?? ""); setMoveOpen(true); }}>{t("gx.pl.move")}</Button>
          <Button variant="secondary" loading={busy === "template"} disabled={busy !== null} aria-label={label("gx.pl.saveTemplate")} onClick={() => void copy("template")}>{t("gx.pl.saveTemplate")}</Button>
        </>
      )}
      <Sheet open={moveOpen} title={t("gx.pl.moveTitle", { plan: plan.title })} closeLabel={t("gx.pl.close")} onClose={() => setMoveOpen(false)}>
        <form className={s.sheetBody} onSubmit={(e) => { e.preventDefault(); void move(); }}>
          <div className="field">
            <label className="field-label" htmlFor={`mv-${plan.id}`}>{t("gx.pl.moveTo")}</label>
            <Select id={`mv-${plan.id}`} value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">{t("gx.pl.moveNone")}</option>
              {folders.map((f) => <option key={f.id} value={f.id}>{f.coachName ? `${f.name} (${f.coachName})` : f.name}</option>)}
            </Select>
          </div>
          <div className="actions"><Button type="submit" loading={busy === "move"}>{t("gx.pl.moveSubmit")}</Button></div>
        </form>
      </Sheet>
    </div>
  );
}
