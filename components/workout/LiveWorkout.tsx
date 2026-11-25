"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SyncStatus } from "@/components/customer/workout/SyncStatus";
import { useWorkoutLogger } from "@/components/customer/workout/useWorkoutLogger";
import { Button, ButtonLink } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Sheet";
import { PageHeader } from "@/components/ui/PageHeader";
import { ProgressBar } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { isSetOp, type QueuedOp, type SetPayload } from "@/lib/customer/queue";
import type { LiveWorkoutData } from "@/lib/customer/live";
import { useI18n } from "@/lib/i18n/client";
import { formatSeconds } from "@/lib/customer/format";
import {
  buildBlocks,
  buildRows,
  executionOrder,
  formatClock,
  itemKeyOf,
  nextOpenSlot,
  prefillRow,
  progressOf,
  restAfterTick,
  rowToSet,
  savedFromPayload,
  totalsOf,
  rowFromSaved,
  type LiveBlock,
  type RowProblem,
  type RowState,
  type RowsByItem,
  type SavedSet,
} from "@/lib/workouts/live/model";
import { addRest, startRest, type Rest } from "@/lib/workouts/live/rest";
import { ExerciseCard } from "./ExerciseCard";
import { FinishSummary, type BestRow } from "./FinishSummary";
import { RestTimer, useNow } from "./RestTimer";
import { fieldId } from "./SetRow";
import { SupersetBracket } from "./SupersetBracket";
import s from "./Workout.module.css";

/** What was last sent for a set, without the device time, to tell an edit from a plain tap away. */
const sigOf = (set: SetPayload) => JSON.stringify({ ...set, completedAt: undefined });
/** Current time in ms (kept out of render code so handlers read it when they run). */
const clock = () => Date.now();
const startKey = (memberId: string, date: string) => `lw.start.${memberId}.${date}`;

function initialRows(data: LiveWorkoutData, blocks: LiveBlock[]): RowsByItem {
  const out: RowsByItem = {};
  for (const b of blocks) {
    for (const it of b.items) {
      const key = itemKeyOf(it);
      out[key] = buildRows(it, b, data.last[it.exerciseId] ?? [], data.saved[key] ?? [], data.memberId, data.date);
    }
  }
  return out;
}

/**
 * The live workout: today's plan as blocks (single exercises and supersets with rounds), a set grid
 * per exercise, one rest timer, progress and a calm finish summary. Every tick is saved on the phone
 * first (the offline queue) and replayed to the server, so it works with a bad connection.
 */
export function LiveWorkout({ data, backHref }: { data: LiveWorkoutData; backHref: string }) {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const blocks = useMemo(() => buildBlocks(data.items), [data.items]);
  const itemsByKey = useMemo(() => new Map(data.items.map((i) => [itemKeyOf(i), i])), [data.items]);
  const [rows, setRows] = useState<RowsByItem>(() => initialRows(data, blocks));
  const rowsRef = useRef(rows);
  const commit = useCallback((next: RowsByItem) => {
    rowsRef.current = next;
    setRows(next);
  }, []);
  const [problems, setProblems] = useState<Record<string, RowProblem | undefined>>({});
  const [rest, setRest] = useState<Rest | null>(null);
  const restSeq = useRef(0);
  const [focusReq, setFocusReq] = useState<{ id: string; n: number } | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [finishOpen, setFinishOpen] = useState(false);
  const [finished, setFinished] = useState<{ elapsed: number } | null>(null);
  const [bests, setBests] = useState<Record<string, { metric: string; value: number; previous: number | null }[]>>({});
  const sent = useRef(new Map<string, string>());

  const logger = useWorkoutLogger(data, {
    refreshOnSync: false,
    onSynced: (op: QueuedOp, body: unknown) => {
      if (!isSetOp(op)) return;
      const list = (body as { newBests?: { metric: string; value: number; previous: number | null }[] } | null)?.newBests;
      if (Array.isArray(list)) setBests((b) => ({ ...b, [`${op.assignmentId}:${op.planItemId}`]: list }));
    },
  });

  // Sets queued on this phone (not on the server yet) lay over the server's sets after the first render,
  // and the workout clock keeps counting across a reload.
  useEffect(() => {
    const queued = logger.queue.filter((q) => isSetOp(q) && q.memberId === data.memberId && q.scheduledFor === data.date);
    let next = rowsRef.current;
    for (const op of queued) {
      if (!isSetOp(op)) continue;
      const key = `${op.assignmentId}:${op.planItemId}`;
      const list = next[key];
      if (!list) continue;
      next = {
        ...next,
        [key]: list.map((r) => {
          const p = op.sets.find((x) => x.setNumber === r.setNumber);
          return p ? rowFromSaved(r, savedFromPayload(p)) : r;
        }),
      };
    }
    if (next !== rowsRef.current) commit(next);
    for (const [key, list] of Object.entries(rowsRef.current)) {
      const metric = itemsByKey.get(key)?.metricType;
      if (!metric) continue;
      for (const r of list) {
        const res = r.done ? rowToSet(metric, r) : null;
        if (res?.ok) sent.current.set(r.clientId, sigOf(res.set));
      }
    }
    let started = Date.now();
    try {
      const raw = window.localStorage.getItem(startKey(data.memberId, data.date));
      if (raw && Number(raw) > 0) started = Number(raw);
      else window.localStorage.setItem(startKey(data.memberId, data.date), String(started));
    } catch {
      // storage blocked: the clock just starts now
    }
    setStartedAt(started);
    // Runs once on mount: the queue snapshot at that moment is what we merge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const now = useNow(finished === null, 1000);
  const elapsed = finished ? finished.elapsed : startedAt && now ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;

  // Move focus after a tick. Touch phones go to the next tick button (no keyboard pops up); a mouse or
  // keyboard goes to the first field of the next set.
  useEffect(() => {
    if (!focusReq) return;
    const el = document.getElementById(focusReq.id);
    if (!el) return;
    el.focus({ preventScroll: true });
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: calm ? "auto" : "smooth" });
  }, [focusReq]);

  const progress = progressOf(blocks, rows);
  const totals = totalsOf(blocks, rows);

  function focusSlot(slot: { itemKey: string; setNumber: number }) {
    const item = itemsByKey.get(slot.itemKey)!;
    const fine = window.matchMedia("(pointer: fine)").matches;
    const first = { WEIGHT_REPS: "weight", REPS: "reps", TIME: "seconds", DISTANCE_TIME: "meters", SCORE: "made", CHECKLIST: "tick" }[item.metricType];
    setFocusReq((f) => ({ id: fieldId(slot.itemKey, slot.setNumber, fine ? first : "tick"), n: (f?.n ?? 0) + 1 }));
  }

  function change(itemKey: string, setNumber: number, patch: Partial<RowState>) {
    const cur = rowsRef.current;
    commit({ ...cur, [itemKey]: cur[itemKey]!.map((r) => (r.setNumber === setNumber ? { ...r, ...patch } : r)) });
    setProblems((p) => (p[`${itemKey}#${setNumber}`] ? { ...p, [`${itemKey}#${setNumber}`]: undefined } : p));
  }

  function save(item: (typeof data.items)[number], sets: SetPayload[], complete: boolean) {
    logger.performSets({ memberId: data.memberId, assignmentId: item.assignmentId, planItemId: item.planItemId, scheduledFor: data.date, sets, complete });
    if (!navigator.onLine) toast(t("cu.toast.queued"), "info");
  }

  function tick(itemKey: string, setNumber: number) {
    const item = itemsByKey.get(itemKey)!;
    const cur = rowsRef.current;
    const row = cur[itemKey]!.find((r) => r.setNumber === setNumber)!;
    if (row.done) return;
    const res = rowToSet(item.metricType, row, new Date().toISOString());
    if (!res.ok) {
      setProblems((p) => ({ ...p, [`${itemKey}#${setNumber}`]: res.problem }));
      setFocusReq((f) => ({ id: fieldId(itemKey, setNumber, res.field), n: (f?.n ?? 0) + 1 }));
      return;
    }
    const next: RowsByItem = { ...cur, [itemKey]: cur[itemKey]!.map((r) => (r.setNumber === setNumber ? { ...r, done: true } : r)) };
    commit(next);
    sent.current.set(row.clientId, sigOf(res.set));
    const exerciseDone = next[itemKey]!.every((r) => r.done);
    save(item, [res.set], exerciseDone);

    const order = executionOrder(blocks, next);
    const upcoming = nextOpenSlot(order, next, { itemKey, setNumber });
    const slot = order.find((o) => o.itemKey === itemKey && o.setNumber === setNumber)!;
    const secs = restAfterTick(blocks[slot.blockIndex]!, slot.itemIndex, setNumber, next);
    if (secs && upcoming) setRest(startRest(++restSeq.current, clock(), secs));
    if (upcoming) focusSlot(upcoming);
  }

  /** Editing a ticked set and leaving the row saves the new numbers (same set id, so it replaces the old). */
  function leaveRow(itemKey: string, setNumber: number) {
    const item = itemsByKey.get(itemKey)!;
    const row = rowsRef.current[itemKey]?.find((r) => r.setNumber === setNumber);
    if (!row || !row.done) return;
    const res = rowToSet(item.metricType, row);
    if (!res.ok) return;
    const sig = sigOf(res.set);
    if (sent.current.get(row.clientId) === sig) return;
    sent.current.set(row.clientId, sig);
    save(item, [res.set], false);
  }

  function addSet(itemKey: string) {
    const item = itemsByKey.get(itemKey)!;
    const cur = rowsRef.current[itemKey]!;
    const n = Math.max(...cur.map((r) => r.setNumber)) + 1;
    const prev = cur[cur.length - 1]!;
    const base = prefillRow(item, n, [], data.memberId, data.date);
    const row: RowState = { ...base, weight: prev.weight, reps: prev.reps, seconds: prev.seconds, meters: prev.meters, made: "", outOf: prev.outOf, setType: prev.setType === "warmup" ? "normal" : prev.setType };
    commit({ ...rowsRef.current, [itemKey]: [...cur, row] });
    focusSlot({ itemKey, setNumber: n });
  }

  function finish() {
    setFinishOpen(false);
    // Every exercise with logged sets is marked complete (send its last logged set again with complete).
    for (const b of blocks) {
      for (const it of b.items) {
        const list = rowsRef.current[itemKeyOf(it)] ?? [];
        const done = list.filter((r) => r.done);
        const last = done[done.length - 1];
        if (!last) continue;
        const res = rowToSet(it.metricType, last);
        if (res.ok) save(it, [res.set], true);
      }
    }
    setRest(null);
    setFinished({ elapsed });
    window.scrollTo({ top: 0 });
  }

  const queuedSets = logger.queue.filter((q) => isSetOp(q)).length;
  const bestRows: BestRow[] = Object.entries(bests).flatMap(([key, list]) => list.map((b) => ({ exercise: itemsByKey.get(key)?.exerciseName ?? "", ...b })));

  if (finished) {
    return (
      <div className="stack">
        <SyncStatus queued={logger.queue.length} online={logger.online} syncing={logger.syncing} report={logger.report} />
        <FinishSummary
          totals={totals}
          elapsedSeconds={finished.elapsed}
          bests={bestRows}
          bestsState={logger.queue.length > 0 ? (logger.online ? "checking" : "waiting") : logger.syncing ? "checking" : "ready"}
          backHref={backHref}
        />
      </div>
    );
  }

  const cur = progress.current;
  const roundText = cur === null ? t("lw.progress.allDone") : cur.type === "superset" ? t("lw.progress.round", { round: cur.round, rounds: cur.rounds }) : t("lw.progress.set", { round: cur.round, rounds: cur.rounds });
  const syncTone = !logger.online ? "warn" : queuedSets > 0 || logger.syncing ? "info" : "ok";
  const syncText = !logger.online ? t("lw.sync.offline") : logger.syncing ? t("lw.sync.syncing") : queuedSets > 0 ? t("lw.sync.pending", { n: queuedSets }) : t("lw.sync.saved");

  return (
    <div className={s.live}>
      <PageHeader title={t("lw.title")} subtitle={undefined} />
      <section className={s.top} aria-label={t("lw.progress.label")}>
        <div className={s.topRow}>
          <span className={s.topStrong}>{roundText}</span>
          <span className={s.topMeta} data-testid="sets-progress">{t("lw.progress.sets", { done: progress.done, total: progress.total })}</span>
        </div>
        <ProgressBar value={progress.done} max={Math.max(1, progress.total)} label={t("lw.progress.label")} />
        <div className={s.topChips}>
          <span className={s.topMeta}>
            {t("lw.elapsed")}: <span className={s.clock} data-testid="elapsed">{formatClock(elapsed)}</span>
          </span>
          <span className={s.sync} data-tone={syncTone} data-testid="sync-chip" role="status">{syncText}</span>
        </div>
      </section>
      <SyncStatus queued={logger.queue.length} online={logger.online} syncing={logger.syncing} report={logger.report} />
      {data.skippedCount > 0 && <p className={s.skipped}>{t("lw.skippedNote", { n: data.skippedCount })}</p>}

      {blocks.map((b, bi) => {
        const prevPlan = bi > 0 ? blocks[bi - 1]!.items[0]!.planId : null;
        const plan = b.items[0]!;
        const caption = prevPlan !== plan.planId ? <p className={s.planCaption}>{t("lw.plan", { title: plan.planTitle })}</p> : null;
        const cards = b.items.map((it) => {
          const key = itemKeyOf(it);
          const problemMap: Record<number, RowProblem | undefined> = {};
          for (const r of rows[key] ?? []) problemMap[r.setNumber] = problems[`${key}#${r.setNumber}`];
          return (
            <ExerciseCard
              key={key}
              item={it}
              inSuperset={b.type === "superset"}
              rows={rows[key] ?? []}
              last={(data.last[it.exerciseId] ?? []) as SavedSet[]}
              problems={problemMap}
              onChange={(n, patch) => change(key, n, patch)}
              onTick={(n) => tick(key, n)}
              onBlurRow={(n) => leaveRow(key, n)}
              onAddSet={() => addSet(key)}
            />
          );
        });
        if (b.type === "single") {
          return (
            <div key={b.key} className={s.bracketBody}>
              {caption}
              {cards}
            </div>
          );
        }
        const restSecs = b.items[b.items.length - 1]!.restSeconds ?? Math.max(0, ...b.items.map((i) => i.restSeconds ?? 0));
        const restText = restSecs > 0 ? (b.items.length === 2 ? t("lw.block.restBoth", { d: formatSeconds(restSecs, locale) }) : t("lw.block.restRound", { d: formatSeconds(restSecs, locale) })) : "";
        const meta = [t("lw.block.rounds", { rounds: b.rounds }), restText].filter(Boolean).join(" · ");
        return (
          <div key={b.key} className={s.bracketBody}>
            {caption}
            <SupersetBracket tag={t("lw.block.superset", { label: b.label ?? "" })} meta={meta} regionLabel={t("lw.block.superset", { label: b.label ?? "" })}>
              {cards}
            </SupersetBracket>
          </div>
        );
      })}

      <div className="stack">
        <Button size="lg" onClick={() => setFinishOpen(true)} disabled={totals.setsDone === 0}>
          {t("lw.finish.button")}
        </Button>
        {totals.setsDone === 0 && <p className={s.hint}>{t("lw.finish.nothing")}</p>}
        <ButtonLink href={backHref} variant="ghost">{t("lw.back")}</ButtonLink>
      </div>

      {rest && (
        <RestTimer
          key={rest.id}
          rest={rest}
          onSkip={() => setRest(null)}
          onAdd={() => setRest((r) => (r ? addRest(r, clock()) : r))}
          onDismiss={() => setRest(null)}
        />
      )}
      <ConfirmDialog
        open={finishOpen}
        title={t("lw.finish.title")}
        text={totals.setsDone >= totals.setsPlanned ? t("lw.finish.bodyAll", { total: totals.setsPlanned }) : t("lw.finish.body", { done: totals.setsDone, total: totals.setsPlanned })}
        confirmLabel={t("lw.finish.confirm")}
        cancelLabel={t("lw.finish.cancel")}
        onCancel={() => setFinishOpen(false)}
        onConfirm={finish}
      />
    </div>
  );
}
