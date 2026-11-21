"use client";
import { useState } from "react";
import { saveAvailabilityAction } from "@/app/[role]/_actions/sessions";
import { Button, IconButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormField, TextInput } from "@/components/ui/Form";
import { useToast } from "@/components/ui/Toast";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n";
import { fromApi, MAX_SLOTS, newSlot, signature, toPayload, validateSlots, type SlotDraft } from "@/lib/sessions/availability";
import { describeError } from "./WarningList";
import s from "./sessions.module.css";

type Initial = { weekday: number; startTime: string; endTime: string; venueId: string | null }[];

/** Weekly availability: time ranges per weekday. Rules match the API; nothing here blocks scheduling, it only drives warnings. */
export function AvailabilityEditor({ initial }: { initial: Initial }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [slots, setSlots] = useState<SlotDraft[]>(() => fromApi(initial));
  const [saved, setSaved] = useState(() => signature(fromApi(initial)));
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const { errors, tooMany } = validateSlots(slots);
  const dirty = signature(slots) !== saved;
  const update = (key: string, patch: Partial<SlotDraft>) => setSlots((cur) => cur.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  async function save() {
    setShown(true);
    setProblem(null);
    if (errors.length || tooMany) return;
    setBusy(true);
    try {
      const res = await saveAvailabilityAction(toPayload(slots));
      if (res.ok) {
        const next = fromApi(res.data);
        setSlots(next);
        setSaved(signature(next));
        setShown(false);
        toast(t("avail.saved"));
      } else setProblem(describeError(t, res));
    } catch {
      setProblem(t("sess.err.offlineAction"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.stack}>
      <p className="muted">{t("avail.intro")}</p>
      {shown && (errors.length > 0 || tooMany) && (
        <p className={s.errorBox} role="alert">{tooMany ? t("avail.err.tooMany", { n: MAX_SLOTS }) : t("avail.err.summary")}</p>
      )}
      {[1, 2, 3, 4, 5, 6, 7].map((day) => {
        const list = slots.map((x, index) => ({ x, index })).filter(({ x }) => x.weekday === day);
        const dayName = t(`plans.weekday.${day}` as MessageKey);
        return (
          <Card key={day} title={dayName} className={s.availDay} actions={
            <Button variant="secondary" onClick={() => setSlots((cur) => [...cur, newSlot(day)])} aria-label={t("avail.add.aria", { day: dayName })}>
              {t("avail.add")}
            </Button>
          }>
            {list.length === 0 ? (
              <p className="muted small">{t("avail.none")}</p>
            ) : (
              <ul className={s.slotList}>
                {list.map(({ x, index }) => {
                  const e = (f: string) => {
                    const found = errors.find((z) => z.index === index && (z.code === "overlap" ? f === "endTime" : z.field === f));
                    if (!shown || !found) return undefined;
                    return found.code === "overlap" ? t("avail.err.overlap", { day: dayName }) : t(`avail.err.${found.code}` as MessageKey);
                  };
                  return (
                    <li key={x.key} className={s.slot}>
                      <div className={s.slotRow}>
                        <FormField label={t("avail.start")} error={e("startTime")}>
                          {(p) => <TextInput {...p} type="time" value={x.startTime} onChange={(ev) => update(x.key, { startTime: ev.target.value })} />}
                        </FormField>
                        <FormField label={t("avail.end")} error={e("endTime")}>
                          {(p) => <TextInput {...p} type="time" value={x.endTime} onChange={(ev) => update(x.key, { endTime: ev.target.value })} />}
                        </FormField>
                        <IconButton label={t("avail.remove.aria", { day: dayName })} onClick={() => setSlots((cur) => cur.filter((z) => z.key !== x.key))}>×</IconButton>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        );
      })}
      {problem && <p className={s.errorBox} role="alert">{problem}</p>}
      <div className={s.saveBar}>
        <Button onClick={() => void save()} loading={busy} disabled={!dirty && !busy}>{t("avail.save")}</Button>
        {dirty && <span className="muted small">{t("avail.unsaved")}</span>}
      </div>
    </div>
  );
}
