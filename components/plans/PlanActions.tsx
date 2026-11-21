"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { archivePlanAction, assignPlanAction, listAssignableMembersAction } from "@/app/[role]/_actions/plans";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { DateInput, TextInput } from "@/components/ui/Form";
import { ConfirmDialog, Sheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { useI18n } from "@/lib/i18n/client";
import { todayInTenantZone, validateAssign } from "@/lib/plans/form";
import type { AssignOutcome, MemberOption } from "@/lib/plans/result";
import s from "./plans.module.css";

export type PlanRowInfo = { id: string; title: string; status: string };

/** Row buttons for one plan: edit, assign (active plans) and archive (with a confirm step). */
export function PlanActions({ role, plan }: { role: string; plan: PlanRowInfo }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [assignOpen, setAssignOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);

  async function archive() {
    setArchiving(true);
    const res = await archivePlanAction(plan.id);
    setArchiving(false);
    setArchiveOpen(false);
    if (res.ok) {
      toast(t("plans.archiveDialog.done"));
      router.refresh();
    } else toast(t("plans.archiveDialog.failed"), "danger");
  }

  if (plan.status === "archived") return null;
  return (
    <div className={s.rowActions}>
      <ButtonLink variant="secondary" href={`/${role}/plans/${plan.id}`}>{t("plans.edit")}</ButtonLink>
      {plan.status === "active" && <Button variant="secondary" onClick={() => setAssignOpen(true)}>{t("plans.assign")}</Button>}
      <Button variant="ghost" disabled={archiving} onClick={() => setArchiveOpen(true)}>{t("plans.archive")}</Button>
      <AssignSheet open={assignOpen} plan={plan} onClose={() => setAssignOpen(false)} />
      <ConfirmDialog
        open={archiveOpen}
        title={t("plans.archiveDialog.title")}
        text={t("plans.archiveDialog.text")}
        confirmLabel={t("plans.archiveDialog.confirm")}
        cancelLabel={t("plans.archiveDialog.cancel")}
        danger
        onConfirm={() => void archive()}
        onCancel={() => setArchiveOpen(false)}
      />
    </div>
  );
}

function AssignSheet({ open, plan, onClose }: { open: boolean; plan: PlanRowInfo; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Sheet open={open} title={t("plans.assignSheet.title", { plan: plan.title })} closeLabel={t("plans.assignSheet.close")} onClose={onClose}>
      <AssignBody plan={plan} onClose={onClose} />
    </Sheet>
  );
}

function AssignBody({ plan, onClose }: { plan: PlanRowInfo; onClose: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [members, setMembers] = useState<MemberOption[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [startsOn, setStartsOn] = useState(() => todayInTenantZone());
  const [endsOn, setEndsOn] = useState("");
  const [note, setNote] = useState("");
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<AssignOutcome[] | null>(null);

  useEffect(() => {
    let live = true;
    void listAssignableMembersAction().then((res) => {
      if (!live) return;
      if (res.ok) setMembers(res.data);
      else setLoadFailed(true);
    });
    return () => {
      live = false;
    };
  }, []);

  const shown = useMemo(() => (members ?? []).filter((m) => m.name.toLowerCase().includes(filter.trim().toLowerCase())), [members, filter]);

  const toggle = (id: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function submit() {
    setProblem(null);
    const found = validateAssign({ memberIds: [...picked], startsOn, endsOn, note });
    const map: Record<string, string> = {};
    for (const e of found) {
      map[e.field] =
        e.field === "memberIds" ? t("plans.assignSheet.errMembers") : e.field === "startsOn" ? t("plans.assignSheet.errStart") : e.field === "endsOn" ? t("plans.assignSheet.errDates") : t("plans.assignSheet.errNote");
    }
    setErrs(map);
    if (found.length > 0) return;
    setBusy(true);
    const chosen = (members ?? []).filter((m) => picked.has(m.id)).map((m) => ({ id: m.id, name: m.name }));
    const res = await assignPlanAction({ planId: plan.id, members: chosen, startsOn, endsOn: endsOn || null, note: note.trim() || null });
    setBusy(false);
    if (!res.ok) {
      setProblem(res.code === "validation_failed" ? res.details?.map((d) => d.message).join(" ") || t("plans.assignSheet.failed") : t("plans.assignSheet.failed"));
      return;
    }
    const ok = res.data.filter((o) => o.ok).length;
    const failed = res.data.length - ok;
    router.refresh();
    if (failed === 0) {
      toast(t("plans.assignSheet.success", { n: ok }));
      onClose();
    } else {
      toast(t("plans.assignSheet.partial", { ok, failed }), "warn");
      setOutcomes(res.data);
    }
  }

  const failText = (o: AssignOutcome) =>
    o.code === "conflict" ? t("plans.assignSheet.fail.conflict") : o.code === "forbidden" ? t("plans.assignSheet.fail.forbidden") : o.code === "not_found" ? t("plans.assignSheet.fail.not_found") : t("plans.assignSheet.fail.other");

  if (outcomes) {
    return (
      <div className={s.assignBody}>
        <h3 className="card-title">{t("plans.assignSheet.results")}</h3>
        <ul className={s.outcomes}>
          {outcomes.map((o) => (
            <li key={o.memberId} className={s.outcome}>
              <span>{o.name}</span>
              {o.ok ? <Badge tone="ok">{t("plans.assignSheet.ok")}</Badge> : <Badge tone="danger">{failText(o)}</Badge>}
            </li>
          ))}
        </ul>
        <div className="actions"><Button onClick={onClose}>{t("plans.assignSheet.close")}</Button></div>
      </div>
    );
  }

  return (
    <form className={s.assignBody} onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
      {plan.status !== "active" && <p className="msg-error" role="alert">{t("plans.assignSheet.onlyActive")}</p>}
      {problem && <p className="msg-error" role="alert">{problem}</p>}

      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} aria-describedby={errs.memberIds ? "as-members-err" : undefined}>
        <legend className="field-label">{t("plans.assignSheet.members")}</legend>
        {members === null && !loadFailed && <p className="muted" role="status">{t("plans.assignSheet.loading")}</p>}
        {loadFailed && <p className="msg-error" role="alert">{t("plans.assignSheet.loadError")}</p>}
        {members !== null && members.length === 0 && <p className="muted">{t("plans.assignSheet.none")}</p>}
        {members !== null && members.length > 0 && (
          <>
            <TextInput type="search" aria-label={t("plans.assignSheet.search")} placeholder={t("plans.assignSheet.search")} value={filter} onChange={(e) => setFilter(e.target.value)} autoComplete="off" />
            <div className={s.memberBar}>
              <span className="small muted" aria-live="polite">{t("plans.assignSheet.selected", { n: picked.size })}</span>
              <span>
                <Button variant="ghost" onClick={() => setPicked(new Set([...picked, ...shown.map((m) => m.id)]))}>{t("plans.assignSheet.selectAll")}</Button>
                <Button variant="ghost" onClick={() => setPicked(new Set())}>{t("plans.assignSheet.clear")}</Button>
              </span>
            </div>
            <ul className={s.memberList}>
              {shown.map((m) => (
                <li key={m.id} className={s.memberRow}>
                  <label>
                    <input type="checkbox" checked={picked.has(m.id)} onChange={() => toggle(m.id)} />
                    <span>{m.name}{m.level ? <span className="muted small"> · {m.level}</span> : null}</span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
        {errs.memberIds && <p id="as-members-err" className="field-error">{errs.memberIds}</p>}
      </fieldset>

      <div className={s.twoCol}>
        <div className="field">
          <label className="field-label" htmlFor="as-start">{t("plans.assignSheet.start")}</label>
          <DateInput id="as-start" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} aria-invalid={errs.startsOn ? true : undefined} />
          {errs.startsOn && <p className="field-error">{errs.startsOn}</p>}
        </div>
        <div className="field">
          <label className="field-label" htmlFor="as-end">{t("plans.assignSheet.end")}</label>
          <DateInput id="as-end" value={endsOn} min={startsOn} onChange={(e) => setEndsOn(e.target.value)} aria-invalid={errs.endsOn ? true : undefined} />
          {errs.endsOn && <p className="field-error">{errs.endsOn}</p>}
        </div>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="as-note">{t("plans.assignSheet.note")}</label>
        <TextInput id="as-note" value={note} onChange={(e) => setNote(e.target.value)} autoComplete="off" aria-invalid={errs.note ? true : undefined} />
        {errs.note && <p className="field-error">{errs.note}</p>}
      </div>
      <div className="actions">
        <Button type="submit" loading={busy} disabled={plan.status !== "active"}>{t("plans.assignSheet.submit")}</Button>
      </div>
    </form>
  );
}
