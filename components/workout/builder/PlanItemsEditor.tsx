"use client";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button, IconButton } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/Form";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n";
import type { FormMetricType, ItemForm } from "@/lib/plans/form";
import {
  canMove,
  canMoveBlock,
  formBlocks,
  groupSelected,
  groupSummary,
  leaveGroup,
  moveBlock,
  moveItemSmart,
  removeItem,
  setGroupRest,
  setGroupRounds,
  ungroup,
} from "@/lib/plans/supersets-form";
import p from "@/components/plans/plans.module.css";
import { SupersetBracket } from "../SupersetBracket";
import s from "../Workout.module.css";

type NumField = "sets" | "reps" | "durationSeconds" | "restSeconds" | "targetWeightKg" | "targetDistanceMeters";

/** Which numbers a coach sets for each metric type. The set count is replaced by rounds inside a superset. */
const FIELDS: Record<FormMetricType, NumField[]> = {
  WEIGHT_REPS: ["sets", "reps", "targetWeightKg", "durationSeconds", "restSeconds"],
  REPS: ["sets", "reps", "durationSeconds", "restSeconds"],
  TIME: ["sets", "durationSeconds", "restSeconds"],
  DISTANCE_TIME: ["sets", "targetDistanceMeters", "durationSeconds", "restSeconds"],
  SCORE: ["sets", "reps", "restSeconds"],
  CHECKLIST: [],
};

export type EditorHelpers = {
  idFor: (path: string) => string;
  fieldProps: (path: string) => { id: string; "aria-invalid"?: true; "aria-describedby"?: string };
  fieldError: (path: string) => ReactNode;
  msg: (path: string) => string | undefined;
};

/**
 * The exercises of one plan day in the builder: tick exercises and group them as a superset, bracketed
 * supersets with rounds and a shared rest, move up and down without ever splitting a group, and
 * targets that match how each exercise is logged (weight, reps, seconds, distance).
 */
export function PlanItemsEditor({
  items,
  onChange,
  basePath,
  selected,
  onSelectedChange,
  onAnnounce,
  helpers,
}: {
  items: ItemForm[];
  onChange: (items: ItemForm[]) => void;
  basePath: string;
  selected: ReadonlySet<string>;
  onSelectedChange: (next: Set<string>) => void;
  onAnnounce: (text: string) => void;
  helpers: EditorHelpers;
}) {
  const { t } = useI18n();
  const { idFor, fieldProps, fieldError, msg } = helpers;
  const blocks = formBlocks(items);
  const indexOf = new Map(items.map((it, i) => [it.key, i]));
  const mine = items.filter((i) => selected.has(i.key));

  const patch = (key: string, change: Partial<ItemForm>) => onChange(items.map((i) => (i.key === key ? { ...i, ...change } : i)));
  const toggle = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSelectedChange(next);
  };

  function group() {
    const res = groupSelected(items, selected);
    if (!res) return;
    onChange(res.items);
    const next = new Set(selected);
    for (const i of mine) next.delete(i.key);
    onSelectedChange(next);
    onAnnounce(t("pb.group.created", { label: res.label, n: res.count }));
    requestAnimationFrame(() => document.getElementById(idFor(`${basePath}.group.${res.label}.rounds`))?.focus());
  }

  const numField = (it: ItemForm, ii: number, field: NumField) => {
    const ip = `${basePath}.items[${ii}]`;
    const label: Record<NumField, string> = {
      sets: t("plans.item.sets"),
      reps: it.metricType === "SCORE" ? t("pb.target.attempts") : t("plans.item.reps"),
      durationSeconds: it.metricType === "TIME" ? t("pb.target.seconds") : t("plans.item.duration"),
      restSeconds: t("plans.item.rest"),
      targetWeightKg: t("pb.target.weight"),
      targetDistanceMeters: t("pb.target.distance"),
    };
    const decimal = field === "targetWeightKg";
    return (
      <div className="field" key={field}>
        <label className="field-label" htmlFor={idFor(`${ip}.${field}`)}>{label[field]}</label>
        <TextInput
          {...fieldProps(`${ip}.${field}`)}
          type="number"
          inputMode={decimal ? "decimal" : "numeric"}
          step={decimal ? "0.5" : undefined}
          min={0}
          value={it[field]}
          onChange={(e) => patch(it.key, { [field]: e.target.value })}
        />
        {fieldError(`${ip}.${field}`)}
      </div>
    );
  };

  function card(it: ItemForm, inGroup: boolean) {
    const ii = indexOf.get(it.key)!;
    const ip = `${basePath}.items[${ii}]`;
    const fields = FIELDS[it.metricType].filter((f) => !(inGroup && f === "sets") && !(inGroup && f === "restSeconds"));
    return (
      <li key={it.key} className={p.item} data-testid="plan-item">
        <div className={p.itemHead}>
          <label className={s.sel}>
            <input type="checkbox" checked={selected.has(it.key)} onChange={() => toggle(it.key)} aria-label={t("pb.select", { name: it.exerciseName })} />
          </label>
          <span className={p.itemName}>
            {ii + 1}. {it.exerciseName}
            <br />
            <span className={s.metricBadge}>
              <Badge>{t("pb.item.metric", { metric: t(`we.metric.${it.metricType}` as MessageKey) })}</Badge>
            </span>
          </span>
          <div className={p.itemTools}>
            <IconButton label={t("plans.item.up", { name: it.exerciseName })} disabled={!canMove(items, it.key, -1)} onClick={() => onChange(moveItemSmart(items, it.key, -1))}>↑</IconButton>
            <IconButton label={t("plans.item.down", { name: it.exerciseName })} disabled={!canMove(items, it.key, 1)} onClick={() => onChange(moveItemSmart(items, it.key, 1))}>↓</IconButton>
            {inGroup && <IconButton label={t("pb.group.leave", { name: it.exerciseName })} onClick={() => onChange(leaveGroup(items, it.key))}>⇥</IconButton>}
            <IconButton label={t("plans.item.remove", { name: it.exerciseName })} onClick={() => onChange(removeItem(items, it.key))}>×</IconButton>
          </div>
        </div>
        {fields.length > 0 && <div className={p.numbers}>{fields.map((f) => numField(it, ii, f))}</div>}
        {msg(ip) && <p className="field-error" role="alert">{msg(ip)}</p>}
        {msg(`${ip}.supersetGroup`) && <p className="field-error" role="alert">{msg(`${ip}.supersetGroup`)}</p>}
        <div className="field">
          <label className="field-label" htmlFor={idFor(`${ip}.notes`)}>{t("plans.item.notes")}</label>
          <TextInput {...fieldProps(`${ip}.notes`)} value={it.notes} onChange={(e) => patch(it.key, { notes: e.target.value })} autoComplete="off" />
          {fieldError(`${ip}.notes`)}
        </div>
      </li>
    );
  }

  return (
    <div className={s.blockWrap}>
      <ol className={p.itemList}>
        {blocks.map((b) => {
          if (b.type === "single") return card(b.items[0]!, false);
          const label = b.label!;
          const sum = groupSummary(b);
          const rounds = Number(sum.rounds);
          const tag = rounds === 1 ? t("pb.group.summaryOne", { label }) : t("pb.group.summary", { label, rounds: sum.rounds || "?" });
          const first = b.items[0]!.key;
          return (
            <li key={`g-${label}-${first}`}>
              <SupersetBracket
                tag={tag}
                regionLabel={t("pb.group.region", { label })}
                tools={
                  <>
                    <IconButton label={t("pb.group.up", { label })} disabled={!canMoveBlock(items, first, -1)} onClick={() => onChange(moveBlock(items, first, -1))}>↑</IconButton>
                    <IconButton label={t("pb.group.down", { label })} disabled={!canMoveBlock(items, first, 1)} onClick={() => onChange(moveBlock(items, first, 1))}>↓</IconButton>
                    <Button
                      variant="secondary"
                      aria-label={t("pb.group.ungroupAria", { label })}
                      onClick={() => {
                        onChange(ungroup(items, label));
                        onAnnounce(t("pb.group.ungrouped", { label }));
                      }}
                    >
                      {t("pb.group.ungroup")}
                    </Button>
                  </>
                }
              >
                <div className={s.groupFields}>
                  <div className="field">
                    <label className="field-label" htmlFor={idFor(`${basePath}.group.${label}.rounds`)}>{t("pb.group.rounds")}</label>
                    <TextInput
                      {...fieldProps(`${basePath}.group.${label}.rounds`)}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={20}
                      value={sum.rounds}
                      onChange={(e) => onChange(setGroupRounds(items, label, e.target.value))}
                    />
                  </div>
                  <div className="field">
                    <label className="field-label" htmlFor={idFor(`${basePath}.group.${label}.rest`)}>{t("pb.group.rest")}</label>
                    <TextInput
                      {...fieldProps(`${basePath}.group.${label}.rest`)}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      aria-describedby={`${idFor(`${basePath}.group.${label}.rest`)}-hint`}
                      value={sum.rest}
                      onChange={(e) => onChange(setGroupRest(items, label, e.target.value))}
                    />
                    <p id={`${idFor(`${basePath}.group.${label}.rest`)}-hint`} className="field-hint">{t("pb.group.restHint")}</p>
                  </div>
                </div>
                {b.items.map((it) => card(it, true))}
              </SupersetBracket>
            </li>
          );
        })}
      </ol>
      {items.length >= 2 && (
        <div className={s.groupBar}>
          {mine.length === 0 ? (
            <p className={s.groupHint}>{t("pb.group.hint")}</p>
          ) : (
            <>
              <p aria-live="polite">{t("pb.selected", { n: mine.length })}</p>
              {mine.length >= 2 ? <Button onClick={group}>{t("pb.group.button", { n: mine.length })}</Button> : <p className={s.groupHint}>{t("pb.group.needTwo")}</p>}
              <Button variant="ghost" onClick={() => onSelectedChange(new Set([...selected].filter((k) => !mine.some((m) => m.key === k))))}>
                {t("pb.group.clear")}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
