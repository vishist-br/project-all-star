"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge, Button, ConfirmDialog, useToast, type Tone } from "@/components/ui";
import { useI18n } from "@/lib/i18n/client";
import { countByStatus, groupByPlan, targetParts, type WorkoutItem } from "@/lib/customer/items";
import { availableActions, type ItemStatus, type LogAction } from "@/lib/customer/queue";
import type { MessageKey } from "@/lib/i18n";
import { SyncStatus } from "./SyncStatus";
import { useWorkoutLogger } from "./useWorkoutLogger";
import s from "./Workout.module.css";

const TONE: Record<ItemStatus, Tone> = { pending: "neutral", started: "info", stopped: "warn", completed: "ok", skipped: "neutral" };
const LABEL: Record<LogAction, MessageKey> = {
  start: "cu.item.start",
  stop: "cu.item.stop",
  complete: "cu.item.complete",
  skip: "cu.item.skip",
};

function RestTimer({ seconds, onDone }: { seconds: number; onDone: () => void }) {
  const { t } = useI18n();
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    const id = window.setInterval(() => setLeft((l) => Math.max(0, l - 1)), 1000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    if (left > 0) return;
    const id = window.setTimeout(onDone, 4000);
    return () => window.clearTimeout(id);
  }, [left, onDone]);
  return (
    <div className={s.rest} role="timer" aria-label={t("cu.rest.title")}>
      <strong className={s.restTitle}>{t("cu.rest.title")}</strong>
      {/* Announce only the start and the end, not every tick. */}
      <span className={s.restTime} aria-hidden="true">{left}</span>
      <span className="sr-only" role="status">{left > 0 ? t("cu.rest.remaining", { s: seconds }) : t("cu.rest.over")}</span>
      <span className="small" aria-hidden="true">{left > 0 ? t("cu.rest.remaining", { s: left }) : t("cu.rest.over")}</span>
      <Button variant="secondary" onClick={onDone}>{t("cu.rest.skip")}</Button>
    </div>
  );
}

/**
 * Today's workout items of one member, grouped by plan, with one-tap Start, Stop, Complete and a
 * confirmed Skip. Taps are optimistic, saved on the phone first and replayed in order when offline.
 */
export function TodayWorkouts({ memberId, date, items }: { memberId: string; date: string; items: WorkoutItem[] }) {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const logger = useWorkoutLogger(items);
  const [rest, setRest] = useState<{ id: number; seconds: number } | null>(null);
  const [skipping, setSkipping] = useState<WorkoutItem | null>(null);

  const shown = items.map((it) => ({ it, ...logger.statusOf(it) }));
  const counts = countByStatus(shown.map((x) => ({ status: x.status })));
  const allSettled = items.length > 0 && counts.todo === 0;

  function act(it: WorkoutItem, action: LogAction) {
    logger.perform({ memberId, assignmentId: it.assignmentId, planItemId: it.planItemId, scheduledFor: date, action });
    if (!navigator.onLine) toast(t("cu.toast.queued"), "info");
    else if (action === "complete") toast(t("cu.toast.saved"));
    if (action === "complete" && it.restSeconds) {
      const seconds = it.restSeconds;
      setRest((r) => ({ id: (r?.id ?? 0) + 1, seconds }));
    };
  }

  return (
    <div className={s.wrap}>
      <SyncStatus
        queued={logger.queue.length}
        online={logger.online}
        syncing={logger.syncing}
        report={logger.report}
      />
      {rest && <RestTimer key={rest.id} seconds={rest.seconds} onDone={() => setRest(null)} />}
      <p className={s.counts} aria-label={t("cu.today.summary", { done: counts.done, total: items.length })}>
        <Badge tone="ok">{t("cu.count.done", { n: counts.done })}</Badge>
        <Badge tone="info">{t("cu.count.todo", { n: counts.todo })}</Badge>
        {counts.skipped > 0 && <Badge>{t("cu.count.skipped", { n: counts.skipped })}</Badge>}
      </p>
      {allSettled && counts.done > 0 && <p className={s.cheer} role="status">{t("cu.today.allDone")}</p>}
      {groupByPlan(shown.map((x) => x.it)).map((group) => (
        <section key={group.planId} className={s.group} aria-label={group.planTitle}>
          <h3 className={s.groupTitle}>{group.planTitle}</h3>
          <ul className={s.list}>
            {group.items.map((it) => {
              const view = shown.find((x) => x.it === it)!;
              const parts = targetParts(it, t, locale);
              const actions = availableActions(view.status);
              return (
                <li key={`${it.assignmentId}-${it.planItemId}`} className={s.item} data-status={view.status}>
                  <div className={s.head}>
                    <Link href={`/customer/exercise/${it.exerciseId}?item=${it.planItemId}`} className={s.name}>
                      {it.exerciseName}
                      <span className="sr-only"> ({t("cu.item.details")})</span>
                    </Link>
                    <span className={s.badges}>
                      <Badge tone={TONE[view.status]}>{t(`cu.status.${view.status}` as MessageKey)}</Badge>
                      {view.queued && <Badge tone="info">{t("cu.status.queued")}</Badge>}
                    </span>
                  </div>
                  {parts.length > 0 && <p className={s.target}>{parts.join(" · ")}</p>}
                  {it.notes && (
                    <p className={`small muted ${s.note}`}>
                      <span className="sr-only">{t("cu.item.coachNote")}: </span>
                      {it.notes}
                    </p>
                  )}
                  {actions.length > 0 && (
                    <div className={s.actions}>
                      {actions.map((a) => (
                        <Button
                          key={a}
                          variant={a === "complete" ? "primary" : a === "start" ? (view.status === "pending" ? "primary" : "secondary") : a === "skip" ? "ghost" : "secondary"}
                          onClick={() => (a === "skip" ? setSkipping(it) : act(it, a))}
                        >
                          {t(a === "start" && view.status === "stopped" ? "cu.item.resume" : LABEL[a])}
                          <span className="sr-only"> {it.exerciseName}</span>
                        </Button>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <ConfirmDialog
        open={skipping !== null}
        title={t("cu.skip.title")}
        text={skipping ? `${skipping.exerciseName}. ${t("cu.skip.body")}` : undefined}
        confirmLabel={t("cu.skip.confirm")}
        cancelLabel={t("cu.skip.cancel")}
        onCancel={() => setSkipping(null)}
        onConfirm={() => {
          if (skipping) act(skipping, "skip");
          setSkipping(null);
        }}
      />
    </div>
  );
}
