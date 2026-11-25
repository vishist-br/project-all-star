import Link from "next/link";
import { tenantDate } from "@/lib/api/pagination";
import { getExercise } from "@/lib/api/exercises";
import { addDays, getMemberSchedule } from "@/lib/api/schedule";
import { getExerciseHistory } from "@/lib/api/workout-sets";
import { ApiError } from "@/lib/auth/errors";
import { checkRole } from "@/lib/auth/guard";
import { ChildSwitcher } from "@/components/customer/ChildSwitcher";
import { NoMember } from "@/components/customer/NoMember";
import { Badge, ButtonLink, Card, EmptyState } from "@/components/ui";
import { formatSeconds } from "@/lib/customer/format";
import { getCustomerContext } from "@/lib/customer/server";
import {
  chartModel,
  emptyKind,
  formatSet,
  formatValue,
  axisNumber,
  longDay,
  metricsFor,
  monthOf,
  parseRange,
  repRecords,
  selectMetric,
  shortDay,
  statTiles,
  RANGES,
  type HistoryLike,
  type Range,
} from "@/lib/exercise/metrics";
import { membersWhoLogged, supersetNotes } from "@/lib/exercise/server";
import type { Locale, MessageKey } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import type { Role } from "@/lib/nav";
import { getViewer } from "@/lib/viewer";
import { ProgressChart } from "./ProgressChart";
import s from "./exercise.module.css";

type Search = Record<string, string | string[] | undefined>;
const TABS = ["progress", "history", "howto"] as const;
type Tab = (typeof TABS)[number];
const PAGE = 12;

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/** Exercise detail: Progress, History and How to tabs, driven by the URL so every view can be shared and works without JavaScript. */
export async function ExerciseScreen({ role, exerciseId, search }: { role: Role; exerciseId: string; search: Search }) {
  const { t, locale } = await getT();
  const tab: Tab = (TABS as readonly string[]).includes(one(search.tab) ?? "") ? (one(search.tab) as Tab) : "progress";
  const range = parseRange(one(search.range));
  const itemId = one(search.item);

  // Who is being viewed: a customer sees their own (or the chosen child's) data, coach and owner pick a member.
  let db: Awaited<ReturnType<typeof getViewer>>["db"];
  let principal: Awaited<ReturnType<typeof getViewer>>["principal"];
  let memberId: string | null = null;
  let memberName: string | null = null;
  let switcher: React.ReactNode = null;
  let picker: { id: string; name: string }[] = [];
  let todayStr: string;
  if (role === "customer") {
    const ctx = await getCustomerContext();
    if (!ctx.selected) return <NoMember />;
    db = ctx.db;
    principal = ctx.principal;
    memberId = ctx.selected.id;
    memberName = ctx.selected.name;
    todayStr = ctx.today;
    switcher = <ChildSwitcher members={ctx.children} selectedId={ctx.selected.id} />;
  } else {
    const viewer = await getViewer();
    db = viewer.db;
    principal = viewer.principal;
    todayStr = tenantDate(new Date());
    picker = await membersWhoLogged(db, principal, exerciseId);
    const wanted = one(search.memberId);
    memberId = wanted ?? picker[0]?.id ?? null;
    memberName = picker.find((m) => m.id === memberId)?.name ?? null;
  }

  const basePath = `/${role}/exercise/${exerciseId}`;
  const carry = { memberId: role === "customer" ? undefined : memberId ?? undefined, item: itemId, from: one(search.from) };
  const href = (o: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...carry, ...o })) if (v) q.set(k, v);
    const qs = q.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  const backHref = role === "customer" ? (one(search.from) === "progress" ? "/customer/progress/exercises" : "/customer/workouts") : `/${role}/workouts`;

  let exercise: Awaited<ReturnType<typeof getExercise>>;
  try {
    exercise = await getExercise(db, exerciseId);
  } catch (err) {
    if (err instanceof ApiError && err.code === "not_found") {
      return (
        <EmptyState
          title={t("ex.notFound.title")}
          text={t("ex.notFound.body")}
          action={<ButtonLink href={backHref} variant="secondary">{t("xp.back")}</ButtonLink>}
          icon="?"
        />
      );
    }
    throw err;
  }

  const subtitle = [exercise.primaryMuscles[0], exercise.equipment ?? t("ex.bodyweight")].filter(Boolean).join(" · ");
  const tabLabel: Record<Tab, MessageKey> = { progress: "xp.tab.progress", history: "xp.tab.history", howto: "xp.tab.howto" };

  const header = (
    <>
      <Link href={backHref} className={s.back}>
        <span aria-hidden="true">←</span>
        {t("xp.back")}
      </Link>
      <header className={s.head}>
        <h1>{exercise.name}</h1>
        <p className={s.sub} data-testid="exercise-subtitle">{subtitle}</p>
      </header>
      {role !== "customer" && memberId && (
        <>
          {picker.length > 0 && (
            <form method="get" className={s.picker} action={basePath}>
              <input type="hidden" name="tab" value={tab} />
              <input type="hidden" name="range" value={range} />
              <label>
                {t("xp.who.label")}
                <select name="memberId" className="input" defaultValue={memberId}>
                  {!picker.some((m) => m.id === memberId) && <option value={memberId}>{memberName ?? memberId}</option>}
                  {picker.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </label>
              <button type="submit" className="btn btn-secondary">{t("xp.who.show")}</button>
            </form>
          )}
        </>
      )}
      {switcher}
      <div className={s.tablist} role="tablist" aria-label={t("xp.tabs.label")}>
        {TABS.map((id) => (
          <Link
            key={id}
            id={`tab-${id}`}
            href={href({ tab: id === "progress" ? undefined : id, range: range === "3m" ? undefined : range })}
            role="tab"
            aria-selected={id === tab}
            aria-controls="exercise-panel"
            className={s.tab}
            data-testid={`tab-${id}`}
          >
            {t(tabLabel[id])}
          </Link>
        ))}
      </div>
    </>
  );

  const panel = (body: React.ReactNode) => (
    <div className={s.stack}>
      {header}
      <div id="exercise-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className={s.stack}>
        {body}
      </div>
    </div>
  );

  if (tab === "howto") {
    let planItem: Awaited<ReturnType<typeof getMemberSchedule>>["days"][number]["items"][number] | undefined;
    if (role === "customer" && memberId) {
      try {
        checkRole(principal, "getMemberSchedule");
        const schedule = await getMemberSchedule(db, principal, memberId, new URLSearchParams({ from: todayStr, to: addDays(todayStr, 13) }));
        const entries = schedule.days.flatMap((d) => d.items);
        planItem = entries.find((i) => itemId && i.planItemId === itemId) ?? entries.find((i) => i.exerciseId === exerciseId);
      } catch {
        planItem = undefined;
      }
    }
    return panel(<HowTo exercise={exercise} planItem={planItem} t={t} locale={locale} />);
  }

  // Progress and History both need the member's history.
  if (!memberId) {
    return panel(
      <EmptyState title={t("xp.who.empty.title")} text={t("xp.who.empty.body")} icon="○" />,
    );
  }
  let history: Awaited<ReturnType<typeof getExerciseHistory>>;
  try {
    checkRole(principal, "getExerciseHistory");
    history = await getExerciseHistory(db, principal, memberId, exerciseId, new URLSearchParams({ range }));
  } catch (err) {
    if (err instanceof ApiError && err.code === "forbidden") {
      return panel(<EmptyState title={t("member.notYours.title")} text={t("member.notYours.text")} icon="!" />);
    }
    console.error("exercise history failed", err instanceof Error ? err.message : err);
    return panel(
      <div className="state state-error" role="alert">
        <span className="state-icon" aria-hidden="true">!</span>
        <h2 className="state-title">{t("xp.error.title")}</h2>
        <p className="muted">{t("xp.error.body")}</p>
        <ButtonLink href={href({ tab: tab === "progress" ? undefined : tab, range })} variant="secondary">{t("ui.retry")}</ButtonLink>
      </div>,
    );
  }
  const h = history as unknown as HistoryLike & { exerciseName: string };
  const who = role === "customer" ? null : memberName;

  if (tab === "history") {
    const show = Math.min(200, Math.max(PAGE, Number.parseInt(one(search.show) ?? "", 10) || PAGE));
    const visible = h.sessions.slice(0, show);
    const notes = await supersetNotes(db, visible.map((x) => x.logId));
    return panel(
      <>
        <RangeLinks range={range} href={(r) => href({ tab: "history", range: r === "3m" ? undefined : r })} t={t} />
        {who && <p className="muted" role="status">{t("xp.who.viewing", { name: who })}</p>}
        {h.sessions.length === 0 ? (
          <EmptyState
            title={emptyKind(h) === "range" ? t("xp.empty.range") : t("xp.empty.title")}
            text={emptyKind(h) === "range" ? t("xp.empty.rangeBody") : t("xp.empty.body")}
            icon="○"
          />
        ) : (
          <>
            <ol className={s.sessions} aria-label={t("xp.hist.title")} data-testid="history-list">
              {visible.map((sess) => {
                const sup = notes.get(sess.logId);
                return (
                  <Card as="li" key={sess.logId}>
                    <div className={s.sessionHead}>
                      <h3>{longDay(sess.date, locale)}</h3>
                      {sess.status && sess.status !== "completed" && <Badge>{t(`xp.hist.status.${sess.status}` as MessageKey)}</Badge>}
                    </div>
                    {sup && (
                      <p className={s.note}>
                        {sup.partners.length > 0 ? t("xp.hist.superset", { label: sup.label, others: sup.partners.join(", ") }) : t("xp.hist.supersetOnly", { label: sup.label })}
                      </p>
                    )}
                    <ol className={s.sets}>
                      {sess.sets.map((st, i) => {
                        const type = st.setType.toUpperCase();
                        return (
                          <li key={i} className={s.set} data-set-type={st.setType}>
                            <span className={s.setNo}>{t("xp.hist.set", { n: st.setNumber ?? i + 1 })}</span>
                            <span className={s.setVal}>{formatSet(st, { t, locale })}</span>
                            {type !== "NORMAL" && <Badge tone={type === "WARMUP" ? "neutral" : "info"}>{t(`we.setType.${type}` as MessageKey)}</Badge>}
                          </li>
                        );
                      })}
                    </ol>
                    {(sess as { note?: string | null }).note && <p className={s.note}>{t("xp.hist.note", { note: (sess as { note?: string | null }).note! })}</p>}
                  </Card>
                );
              })}
            </ol>
            {h.sessions.length > show && (
              <div className={s.more}>
                <ButtonLink variant="secondary" href={href({ tab: "history", range: range === "3m" ? undefined : range, show: String(show + PAGE) })}>
                  {t("xp.hist.more")}
                </ButtonLink>
              </div>
            )}
          </>
        )}
      </>,
    );
  }

  // Progress tab
  const kind = emptyKind(h);
  const tiles = statTiles(h);
  const metric = selectMetric(h, one(search.metric));
  const model = chartModel(h, metric);
  const fmt = { t, locale };
  const metricName = t(metric.label);
  const rangeLabel = t(`xp.range.${range}` as MessageKey);
  const rows = repRecords(h);
  const sameMonth = model.first && model.latest && monthOf(model.first.date, locale) === monthOf(model.latest.date, locale);
  const caption =
    model.first && model.latest
      ? model.points.length === 1
        ? t("xp.caption.one", { metric: metricName, date: shortDay(model.first.date, locale) })
        : t("xp.caption", {
            metric: metricName,
            from: sameMonth ? shortDay(model.first.date, locale) : monthOf(model.first.date, locale),
            to: sameMonth ? shortDay(model.latest.date, locale) : monthOf(model.latest.date, locale),
          })
      : metricName;

  return panel(
    <>
      {who && <p className="muted" role="status">{t("xp.who.viewing", { name: who })}</p>}
      {kind === "none" ? (
        <EmptyState title={t("xp.empty.title")} text={t("xp.empty.body")} icon="↗" />
      ) : (
        <>
          <div className={s.tiles} role="group" aria-label={t("xp.tiles.label")}>
            {tiles.map((tile) => (
              <div key={tile.id} className={s.tile} data-testid={`tile-${tile.id}`}>
                <span className={s.tileLabel}>{t(tile.label)}</span>
                <span className={s.tileValue}>{formatValue(tile.value, tile.unit, fmt)}</span>
                {tile.id === "sessions" && <span className={s.tileSub}>{rangeLabel}</span>}
                {tile.id !== "sessions" && tile.date && <span className={s.tileSub}>{shortDay(tile.date, locale)}</span>}
              </div>
            ))}
          </div>

          <Card>
            <div className={s.stack}>
              <p className={s.caption} data-testid="chart-caption">{caption}</p>
              <RangeLinks range={range} href={(r) => href({ tab: undefined, range: r === "3m" ? undefined : r, metric: metric.id })} t={t} />
              <nav aria-label={t("xp.metric.label")}>
                <ul className={s.chips}>
                  {metricsFor(h).map((m) => (
                    <li key={m.id}>
                      <Link
                        href={href({ range: range === "3m" ? undefined : range, metric: m.id })}
                        className={s.chip}
                        aria-current={m.id === metric.id ? "true" : undefined}
                        data-testid={`metric-${m.id}`}
                      >
                        {t(m.label)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
              {model.points.length === 0 ? (
                <p className="muted" data-testid="chart-empty">{kind === "range" ? t("xp.empty.rangeBody") : t("xp.chart.noMetric")}</p>
              ) : (
                <>
                  {model.newBestDate && (
                    <p className={s.best} data-testid="new-best">
                      <Badge tone="ok">{t("xp.newBest")}</Badge>
                      <span className="small muted">{shortDay(model.newBestDate, locale)}</span>
                    </p>
                  )}
                  <ProgressChart
                    points={model.points}
                    newBestDate={model.newBestDate}
                    formatAxis={(v) => axisNumber(v, metric.unit, locale)}
                    formatValue={(v) => formatValue(v, metric.unit, fmt)}
                    formatDate={(d) => shortDay(d, locale)}
                    labels={{
                      aria: t("xp.chart.aria", { metric: metricName, name: exercise.name, n: model.points.length, value: formatValue(model.latest!.value, metric.unit, fmt) }),
                      tableCaption: t("xp.chart.table", { metric: metricName }),
                      colDate: t("xp.col.date"),
                      colValue: t("xp.col.value"),
                      newBest: t("xp.newBest"),
                    }}
                  />
                </>
              )}
            </div>
          </Card>

          {rows.length > 0 && (
            <Card title={t("xp.records.title")}>
              <table className={s.records} data-testid="rep-records">
                <thead>
                  <tr>
                    <th scope="col">{t("xp.records.reps")}</th>
                    <th scope="col">{t("xp.records.weight")}</th>
                    <th scope="col">{t("xp.col.date")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.reps}>
                      <th scope="row">{t(r.reps === 1 ? "xp.records.rep1" : "xp.records.repN", { n: r.reps })}</th>
                      <td>{formatValue(r.weightKg, "kg", fmt)}</td>
                      <td>{shortDay(r.date, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}
    </>,
  );
}

function RangeLinks({ range, href, t }: { range: Range; href: (r: Range) => string; t: (k: MessageKey) => string }) {
  return (
    <nav className={s.rangeRow} aria-label={t("xp.range.label")}>
      {RANGES.map((r) => (
        <Link key={r} href={href(r)} className={s.rangeLink} aria-current={r === range ? "true" : undefined} data-testid={`range-${r}`}>
          {t(`xp.range.${r}` as MessageKey)}
        </Link>
      ))}
    </nav>
  );
}

function HowTo({
  exercise,
  planItem,
  t,
  locale,
}: {
  exercise: Awaited<ReturnType<typeof getExercise>>;
  planItem?: { planTitle: string; sets: number | null; reps: number | null; durationSeconds: number | null; restSeconds: number | null; notes: string | null };
  t: (k: MessageKey, p?: Record<string, string | number>) => string;
  locale: Locale;
}) {
  const none = t("cu.stats.noValue");
  const facts: [string, string][] = [];
  if (planItem) {
    if (planItem.sets) facts.push([t("ex.sets"), String(planItem.sets)]);
    if (planItem.reps) facts.push([t("ex.reps"), String(planItem.reps)]);
    if (planItem.durationSeconds) facts.push([t("ex.duration"), formatSeconds(planItem.durationSeconds, locale)]);
    if (planItem.restSeconds) facts.push([t("ex.rest"), formatSeconds(planItem.restSeconds, locale)]);
  }
  return (
    <>
      <div className={s.demo} data-testid="demo-placeholder">
        <span className={s.demoIcon} aria-hidden="true">▶</span>
        <strong>{t("xp.how.demo.title")}</strong>
        <span className="small">{t("xp.how.demo.body")}</span>
      </div>
      {exercise.needsTrainerReview && <p className={s.review} data-testid="review-note">{t("xp.how.review")}</p>}

      {planItem && (
        <Card title={t("ex.inPlan")}>
          <p className="muted">{planItem.planTitle}</p>
          <dl className={s.facts}>
            {facts.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          {planItem.notes && <p className={s.note}>{planItem.notes}</p>}
        </Card>
      )}

      <Card title={t("wk.instructions")}>
        {exercise.instructions.length > 0 ? (
          <ol className={s.steps}>
            {exercise.instructions.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        ) : (
          <p className="muted">{t("ex.noInstructions")}</p>
        )}
      </Card>

      <Card>
        <dl className={s.facts}>
          <div>
            <dt>{t("ex.equipment")}</dt>
            <dd>{exercise.equipment ?? t("ex.bodyweight")}</dd>
          </div>
          <div>
            <dt>{t("ex.level")}</dt>
            <dd>{exercise.level ?? none}</dd>
          </div>
          <div>
            <dt>{t("ex.category")}</dt>
            <dd>{exercise.category ?? none}</dd>
          </div>
        </dl>
        <h3 className={s.h3}>{t("wk.primary")}</h3>
        <ul className={s.badges}>
          {exercise.primaryMuscles.map((m) => (
            <li key={m}><Badge tone="info">{m}</Badge></li>
          ))}
        </ul>
        {exercise.secondaryMuscles.length > 0 && (
          <>
            <h3 className={s.h3}>{t("wk.secondary")}</h3>
            <ul className={s.badges}>
              {exercise.secondaryMuscles.map((m) => (
                <li key={m}><Badge>{m}</Badge></li>
              ))}
            </ul>
          </>
        )}
        {exercise.licence && <p className="small muted">{t("wk.licence", { licence: exercise.licence })}</p>}
      </Card>
    </>
  );
}
