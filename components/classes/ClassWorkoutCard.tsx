"use client";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import {
  attachClassWorkoutAction,
  listClassPlansAction,
  listPlanDaysAction,
  type ClassWorkoutInfo,
  type DayChoice,
  type PlanChoice,
} from "@/app/[role]/_actions/send-classes";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormField, Select } from "@/components/ui/Form";
import { Sheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { useI18n } from "@/lib/i18n/client";
import s from "./classes.module.css";

function subscribe(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

/**
 * "Class workout": attach a plan day to this class (or change or remove it). What is attached is what
 * members see in their class summary. Needs a connection; the roll call itself keeps working offline.
 */
export function ClassWorkoutCard({ role, sessionId, initial }: { role: string; sessionId: string; initial: ClassWorkoutInfo }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  const [info, setInfo] = useState(initial);
  const [open, setOpen] = useState(false);
  const [plans, setPlans] = useState<PlanChoice[] | null>(null);
  const [days, setDays] = useState<DayChoice[]>([]);
  const [planId, setPlanId] = useState("");
  const [dayId, setDayId] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const attached = info.planDayId !== null;

  async function openSheet() {
    setOpen(true);
    setProblem(null);
    if (plans) return;
    setLoading(true);
    try {
      const res = await listClassPlansAction();
      if (res.ok) {
        setPlans(res.data);
        if (res.data.length === 1) await pickPlan(res.data[0]!.id);
      } else setProblem(t("cls.workout.loadErr"));
    } catch {
      setProblem(t("cls.workout.loadErr"));
    } finally {
      setLoading(false);
    }
  }

  async function pickPlan(id: string) {
    setPlanId(id);
    setDayId("");
    setDays([]);
    if (!id) return;
    setLoading(true);
    try {
      const res = await listPlanDaysAction(id);
      if (res.ok) {
        setDays(res.data);
        if (res.data.length === 1) setDayId(res.data[0]!.id);
      } else setProblem(t("cls.workout.loadErr"));
    } catch {
      setProblem(t("cls.workout.loadErr"));
    } finally {
      setLoading(false);
    }
  }

  async function save(next: string | null) {
    setBusy(true);
    setProblem(null);
    try {
      const res = await attachClassWorkoutAction(sessionId, next);
      if (res.ok) {
        setInfo(res.data);
        setOpen(false);
        toast(next ? t("cls.workout.saved") : t("cls.workout.removed"));
        router.refresh();
      } else setProblem(res.code === "conflict" ? t("cls.workout.cancelled") : t("cls.workout.err"));
    } catch {
      setProblem(t("cls.workout.err"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t("cls.workout.title")} className={s.workoutCard}>
      {attached ? (
        <div className={s.attached}>
          <p className={s.attachedName}>{info.planTitle}{info.dayTitle ? ` · ${info.dayTitle}` : ""}</p>
          <p className={s.when}>{t("cls.workout.exerciseCount", { n: info.exerciseCount })}</p>
        </div>
      ) : (
        <p className="muted">{t("cls.workout.none")}</p>
      )}
      <div className={s.actions}>
        <Button variant={attached ? "secondary" : "primary"} onClick={() => void openSheet()} disabled={!online}>
          {attached ? t("cls.workout.change") : t("cls.workout.attach")}
        </Button>
        {attached && <Button variant="ghost" onClick={() => void save(null)} loading={busy && !open} disabled={!online}>{t("cls.workout.remove")}</Button>}
      </div>
      {!online && <p className={s.hint}>{t("cls.workout.offline")}</p>}

      <Sheet open={open} title={t("cls.workout.sheet")} closeLabel={t("cls.finish.close")} onClose={() => setOpen(false)}>
        <div className={s.sheetBody}>
          {loading && !plans && <p className="muted" role="status">{t("cls.workout.loading")}</p>}
          {plans && plans.length === 0 && (
            <>
              <p className="muted">{t("cls.workout.noPlans")}</p>
              <div className="actions"><ButtonLink variant="secondary" href={`/${role}/plans`}>{t("cls.workout.openPlans")}</ButtonLink></div>
            </>
          )}
          {plans && plans.length > 0 && (
            <>
              <FormField label={t("cls.workout.plan")}>
                {(p) => (
                  <Select {...p} value={planId} onChange={(e) => void pickPlan(e.target.value)}>
                    <option value="">{t("cls.workout.planPick")}</option>
                    {plans.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
                  </Select>
                )}
              </FormField>
              {planId && (
                <FormField label={t("cls.workout.day")}>
                  {(p) => (
                    <Select {...p} value={dayId} onChange={(e) => setDayId(e.target.value)} disabled={loading}>
                      <option value="">{t("cls.workout.dayPick")}</option>
                      {days.map((d) => <option key={d.id} value={d.id}>{t("cls.workout.dayLine", { day: d.title ?? t("cls.workout.dayN", { n: d.index }), n: d.exerciseCount })}</option>)}
                    </Select>
                  )}
                </FormField>
              )}
            </>
          )}
          {problem && <p className={s.errorBox} role="alert">{problem}</p>}
          <div className="actions">
            <Button variant="secondary" onClick={() => setOpen(false)}>{t("cls.finish.cancel")}</Button>
            <Button onClick={() => void save(dayId)} disabled={!dayId} loading={busy}>{t("cls.workout.save")}</Button>
          </div>
        </div>
      </Sheet>
    </Card>
  );
}
