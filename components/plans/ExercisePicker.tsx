"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getExerciseAction, searchExercisesAction } from "@/app/[role]/_actions/plans";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Select, TextInput } from "@/components/ui/Form";
import { Sheet } from "@/components/ui/Sheet";
import { useI18n } from "@/lib/i18n/client";
import type { ExerciseFacets } from "@/lib/plans/facets";
import type { ExerciseDetail, ExerciseSummary } from "@/lib/plans/result";
import s from "./plans.module.css";

type Filters = { q: string; sport: string; muscle: string; equipment: string };

/** Searchable, filterable picker over the real exercise catalog. Stays open so several exercises can be added. */
export function ExercisePicker({
  open,
  dayLabel,
  facets,
  onAdd,
  onClose,
}: {
  open: boolean;
  dayLabel: string;
  facets: ExerciseFacets;
  onAdd: (exercise: { id: string; name: string }) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <Sheet open={open} title={t("plans.picker.title")} closeLabel={t("plans.picker.close")} onClose={onClose}>
      <PickerBody dayLabel={dayLabel} facets={facets} onAdd={onAdd} onClose={onClose} />
    </Sheet>
  );
}

function PickerBody({ dayLabel, facets, onAdd, onClose }: { dayLabel: string; facets: ExerciseFacets; onAdd: (e: { id: string; name: string }) => void; onClose: () => void }) {
  const { t } = useI18n();
  const [filters, setFilters] = useState<Filters>({ q: "", sport: "", muscle: "", equipment: "" });
  const [items, setItems] = useState<ExerciseSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, ExerciseDetail | "error" | "loading">>({});
  const seq = useRef(0);

  const load = useCallback(async (f: Filters, after: string | null) => {
    const mine = ++seq.current;
    if (after) setLoadingMore(true);
    else setState("loading");
    const res = await searchExercisesAction({ ...f, ...(after ? { cursor: after } : {}) });
    if (mine !== seq.current) return; // a newer search replaced this one
    setLoadingMore(false);
    if (!res.ok) {
      setState("error");
      return;
    }
    setItems((cur) => (after ? [...cur, ...res.data.items] : res.data.items));
    setCursor(res.data.nextCursor);
    setState("ready");
  }, []);

  // Search as you type (debounced); filter changes apply right away through the same path.
  useEffect(() => {
    const timer = setTimeout(() => void load(filters, null), filters.q ? 250 : 0);
    return () => clearTimeout(timer);
  }, [filters, load]);

  async function toggleDetails(id: string) {
    if (openId === id) return setOpenId(null);
    setOpenId(id);
    if (details[id] && details[id] !== "error") return;
    setDetails((d) => ({ ...d, [id]: "loading" }));
    const res = await getExerciseAction(id);
    setDetails((d) => ({ ...d, [id]: res.ok ? res.data : "error" }));
  }

  const set = (k: keyof Filters) => (v: string) => setFilters((f) => ({ ...f, [k]: v }));
  const opts = (list: string[]) => list.map((o) => <option key={o} value={o}>{o}</option>);

  return (
    <div className={s.pickerBody}>
      <p className="muted small">{t("plans.picker.addingTo", { day: dayLabel })}</p>
      <div className={s.pickerFilters}>
        <div className={`field ${s.pickerSearch}`}>
          <label className="field-label" htmlFor="pk-q">{t("plans.picker.search")}</label>
          <TextInput id="pk-q" type="search" value={filters.q} onChange={(e) => set("q")(e.target.value)} autoComplete="off" />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="pk-sport">{t("wk.sport")}</label>
          <Select id="pk-sport" value={filters.sport} onChange={(e) => set("sport")(e.target.value)}>
            <option value="">{t("wk.all")}</option>
            {opts(facets.sports)}
          </Select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="pk-muscle">{t("wk.muscle")}</label>
          <Select id="pk-muscle" value={filters.muscle} onChange={(e) => set("muscle")(e.target.value)}>
            <option value="">{t("wk.all")}</option>
            {opts(facets.muscles)}
          </Select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="pk-equipment">{t("wk.equipment")}</label>
          <Select id="pk-equipment" value={filters.equipment} onChange={(e) => set("equipment")(e.target.value)}>
            <option value="">{t("wk.all")}</option>
            {opts(facets.equipments)}
          </Select>
        </div>
      </div>

      <p className="sr-only" role="status" aria-live="polite">{announce}</p>

      {state === "loading" && <p className="muted" role="status">{t("plans.picker.loading")}</p>}
      {state === "error" && (
        <div role="alert" className="stack">
          <p className="msg-error">{t("plans.picker.error")}</p>
          <Button variant="secondary" onClick={() => void load(filters, null)}>{t("plans.picker.retry")}</Button>
        </div>
      )}
      {state === "ready" && items.length === 0 && <p className="muted">{t("plans.picker.none")}</p>}
      {state === "ready" && items.length > 0 && (
        <ul className={s.results} aria-label={t("plans.picker.title")}>
          {items.map((e) => {
            const d = details[e.id];
            return (
              <li key={e.id} className={s.result}>
                <div className={s.resultRow}>
                  <div className={s.resultText}>
                    <span className={s.resultName}>{e.name}</span>
                    <span className="small muted">{[e.sportSlug, e.equipment, e.primaryMuscles.join(", ")].filter(Boolean).join(" · ")}</span>
                    {e.needsTrainerReview && <span><Badge tone="warn">{t("wk.draft")}</Badge></span>}
                  </div>
                  <div className={s.resultBtns}>
                    <Button
                      variant="ghost"
                      aria-expanded={openId === e.id}
                      onClick={() => void toggleDetails(e.id)}
                    >
                      {openId === e.id ? t("plans.picker.hideDetails") : t("plans.picker.details")}
                    </Button>
                    <Button
                      aria-label={t("plans.picker.add", { name: e.name })}
                      onClick={() => {
                        onAdd({ id: e.id, name: e.name });
                        setAnnounce(t("plans.picker.added", { name: e.name }));
                      }}
                    >
                      +
                    </Button>
                  </div>
                </div>
                {openId === e.id && (
                  <div className={s.details}>
                    {d === "loading" || d === undefined ? <span className="muted">{t("plans.picker.loading")}</span> : null}
                    {d === "error" && <span className="msg-error">{t("plans.picker.error")}</span>}
                    {d && d !== "loading" && d !== "error" && (
                      <>
                        {d.instructions.length > 0 && (
                          <>
                            <strong>{t("wk.instructions")}</strong>
                            <ol>{d.instructions.map((step, i) => <li key={i}>{step}</li>)}</ol>
                          </>
                        )}
                        {d.secondaryMuscles.length > 0 && <span>{t("wk.secondary")}: {d.secondaryMuscles.join(", ")}</span>}
                        <span className="muted">{t("wk.licence", { licence: d.licence })}</span>
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {cursor && state === "ready" && (
        <Button variant="secondary" loading={loadingMore} onClick={() => void load(filters, cursor)}>{t("plans.picker.more")}</Button>
      )}
      <div className="actions">
        <Button onClick={onClose}>{t("plans.picker.done")}</Button>
      </div>
    </div>
  );
}
