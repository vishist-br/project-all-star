"use client";
import { useMemo, useState, useSyncExternalStore } from "react";
import { sendPlanAction, type SendOutcome } from "@/app/[role]/_actions/send-classes";
import { Avatar, Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DateInput, FormField, Select, TextInput } from "@/components/ui/Form";
import { EmptyState } from "@/components/ui/States";
import { formatDay } from "@/lib/customer/format";
import type { MessageKey } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import {
  buildSendPayload,
  countResults,
  groupAllSelected,
  groupMembers,
  memberLink,
  NOTE_MAX,
  repeatEnd,
  STATUS_TONE,
  toggleEveryone,
  toggleGroup,
  toggleOne,
  validateSend,
  type BatchRow,
  type MemberRow,
  type PlanSummary,
  type RepeatMode,
  type SendErrors,
} from "@/lib/send/view";
import s from "./send.module.css";

function subscribe(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

export function SummaryLine({ summary }: { summary: PlanSummary }) {
  const { t } = useI18n();
  return <p className={s.sumLine}>{summaryText(summary, t)}</p>;
}

export function summaryText(sum: PlanSummary, t: (k: MessageKey, p?: Record<string, string | number>) => string): string {
  const parts = [
    t(sum.exercises === 1 ? "snd.sum.exercise.one" : "snd.sum.exercise.other", { n: sum.exercises }),
    sum.supersets > 0 ? t(sum.supersets === 1 ? "snd.sum.superset.one" : "snd.sum.superset.other", { n: sum.supersets }) : null,
    sum.minutes > 0 ? t("snd.sum.minutes", { n: sum.minutes }) : null,
    sum.days > 1 ? t("snd.sum.days", { n: sum.days }) : null,
  ];
  return parts.filter(Boolean).join(", ");
}

const REPEATS: RepeatMode[] = ["ongoing", "once", "weeks", "until"];

type Props = {
  role: "coach" | "owner";
  plan: { id: string; title: string };
  summary: PlanSummary;
  members: MemberRow[];
  batches: BatchRow[];
  coachName: string;
  today: string;
  /** True when the member list could not be loaded (the screen shows a retry notice). */
  loadFailed?: boolean;
};

/**
 * Send a plan to members: choose who, repeat, start date and a note, see what members will see, send,
 * then read one result per member. Sending needs a connection; choices stay on screen while offline.
 */
export function SendScreen({ role, plan, summary, members, batches, coachName, today, loadFailed }: Props) {
  const { t, locale } = useI18n();
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<RepeatMode>("ongoing");
  const [weeks, setWeeks] = useState("4");
  const [endsOn, setEndsOn] = useState("");
  const [startsOn, setStartsOn] = useState(today);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [outcome, setOutcome] = useState<SendOutcome | null>(null);
  const [copied, setCopied] = useState<"done" | "manual" | null>(null);

  const groups = useMemo(() => groupMembers(members, batches, query), [members, batches, query]);
  const form = { memberIds: [...selected], startsOn, mode, weeks, endsOn, note };
  const errors: SendErrors = validateSend(form);
  const shown = touched ? errors : {};
  const end = repeatEnd(form);
  const nameById = useMemo(() => new Map(members.map((m) => [m.id, m.name])), [members]);

  function errText(kind: keyof SendErrors): string | undefined {
    const code = shown[kind];
    if (!code) return undefined;
    const map: Record<string, MessageKey> = {
      members: "snd.send.none",
      tooMany: "snd.err.validation",
      date: "snd.err.validation",
      tooLong: "snd.err.validation",
      weeks: "snd.err.validation",
      before: "snd.err.validation",
    };
    return t(map[code] ?? "snd.err.validation");
  }

  async function send() {
    setTouched(true);
    setProblem(null);
    if (Object.keys(errors).length > 0) return;
    if (!online) {
      setProblem(t("snd.offline"));
      return;
    }
    setBusy(true);
    try {
      const res = await sendPlanAction(buildSendPayload(plan.id, form));
      if (res.ok) {
        setOutcome(res.data);
        return;
      }
      setProblem(
        res.code === "conflict"
          ? t("snd.err.notActive")
          : res.code === "forbidden"
            ? t("snd.err.notYours")
            : res.code === "validation_failed"
              ? res.details?.some((d) => d.field === "memberIds")
                ? t("snd.err.inactive")
                : t("snd.err.validation")
              : t("snd.err.generic"),
      );
    } catch {
      setProblem(t("snd.err.generic"));
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    const url = memberLink(window.location.origin);
    try {
      await navigator.clipboard.writeText(url);
      setCopied("done");
    } catch {
      setCopied("manual");
    }
  }

  const link = typeof window === "undefined" ? "" : memberLink(window.location.origin);
  const count = selected.size;
  const fmt = (d: string) => formatDay(d, locale);

  if (outcome) return <Results outcome={outcome} role={role} planId={plan.id} onMore={() => { setOutcome(null); setSelected(new Set()); setQuery(""); setTouched(false); setProblem(null); }} nameById={nameById} />;

  const scheduleLine =
    mode === "once" && end
      ? t("snd.preview.schedule.once", { date: fmt(startsOn) })
      : end
        ? t("snd.preview.schedule.ends", { start: fmt(startsOn), end: fmt(end) })
        : startsOn
          ? t("snd.preview.schedule.ongoing", { date: fmt(startsOn) })
          : "";

  return (
    <form
      className={s.wrap}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
      aria-label={t("snd.title")}
    >
      <div>
        <p className={s.planName}>{plan.title}</p>
        <SummaryLine summary={summary} />
      </div>

      {!online && <p className={s.notice} role="status">{t("snd.offline")}</p>}
      {loadFailed && <p className={s.errorBox} role="alert">{t("snd.loadError")}</p>}

      <Card>
        <div className={s.sectionHead}>
          <h2>{t("snd.members.title")}</h2>
          <span className={s.count} aria-live="polite">{t("snd.members.selected", { n: count })}</span>
        </div>
        {members.length === 0 ? (
          <EmptyState title={t("snd.members.empty.title")} text={t("snd.members.empty.text")} action={<ButtonLink variant="secondary" href={`/${role}/members`}>{t("snd.members.empty.action")}</ButtonLink>} icon="☺" />
        ) : (
          <div className={s.groups}>
            <div className="field">
              <label className="field-label" htmlFor="snd-q">{t("snd.members.search")}</label>
              <TextInput id="snd-q" type="search" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
            </div>
            <div className={s.groupHead}>
              <Button variant="ghost" className={s.linkBtn} onClick={() => setSelected(toggleEveryone(selected, members))}>
                {members.every((m) => selected.has(m.id)) ? t("snd.members.clearAll") : t("snd.members.allMine")}
              </Button>
            </div>
            {groups.length === 0 && <p className="muted">{t("snd.members.noMatch")}</p>}
            {groups.map((g) => {
              const all = groupAllSelected(selected, g);
              const name = g.name || t("snd.members.other");
              return (
                <section key={g.id} className={s.group} aria-label={name}>
                  <div className={s.groupHead}>
                    <h3 className={s.groupName}>{name}</h3>
                    {g.name && (
                      <Button variant="ghost" className={s.linkBtn} onClick={() => setSelected(toggleGroup(selected, g))}>
                        {all ? t("snd.members.clearBatch", { batch: name }) : t("snd.members.selectBatch", { batch: name })}
                      </Button>
                    )}
                  </div>
                  <ul className={s.memberList}>
                    {g.members.map((m) => (
                      <li key={m.id} className={s.memberRow}>
                        <label>
                          <input type="checkbox" checked={selected.has(m.id)} onChange={() => setSelected(toggleOne(selected, m.id))} />
                          <Avatar name={m.name} />
                          <span className={s.memberText}>
                            <span className={s.memberName}>{m.name}</span>
                            {m.level && <span className={s.memberMeta}>{m.level}</span>}
                          </span>
                          <span className={s.tick} aria-hidden="true">✓</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
        {shown.members && <p className="field-error" role="alert">{errText("members")}</p>}
      </Card>

      <Card>
        <div className={`${s.fields} ${s.two}`}>
          <FormField label={t("snd.repeat.label")}>
            {(p) => (
              <Select {...p} value={mode} onChange={(e) => setMode(e.target.value as RepeatMode)}>
                {REPEATS.map((r) => <option key={r} value={r}>{t(`snd.repeat.${r}` as MessageKey)}</option>)}
              </Select>
            )}
          </FormField>
          <FormField label={t("snd.starts.label")} error={errText("startsOn")}>
            {(p) => <DateInput {...p} value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />}
          </FormField>
          {mode === "weeks" && (
            <FormField label={t("snd.repeat.weeksLabel")} error={errText("weeks")}>
              {(p) => <TextInput {...p} type="number" inputMode="numeric" min={1} max={52} value={weeks} onChange={(e) => setWeeks(e.target.value)} />}
            </FormField>
          )}
          {mode === "until" && (
            <FormField label={t("snd.repeat.untilLabel")} error={errText("endsOn")}>
              {(p) => <DateInput {...p} min={startsOn} value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />}
            </FormField>
          )}
        </div>
        <div className={s.subField}>
          <FormField label={t("snd.note.label")} hint={t("snd.note.hint", { left: Math.max(0, NOTE_MAX - note.length) })} error={errText("note")}>
            {(p) => <textarea {...p} className={`input ${s.textarea}`} maxLength={NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} />}
          </FormField>
        </div>
      </Card>

      <section aria-label={t("snd.preview.title")}>
        <div className={s.sectionHead}><h2>{t("snd.preview.title")}</h2></div>
        <div className={s.preview}>
          <Badge tone="info">{t("snd.preview.tag", { coach: coachName })}</Badge>
          <p className={s.inboxTitle}>{plan.title}</p>
          <p className={s.inboxMeta}>{[summaryText(summary, t), scheduleLine].filter(Boolean).join(" · ")}</p>
          <div className={s.quote}>
            <span className={s.quoteLabel}>{t("snd.preview.noteLabel")}</span>
            <p className={s.quoteText}>{note.trim() || t("snd.preview.noNote")}</p>
          </div>
          <span className={s.fakeBtn} aria-hidden="true">{t("snd.preview.start")}</span>
        </div>
      </section>

      {problem && <p className={s.errorBox} role="alert">{problem}</p>}

      <div className={s.actionsCol}>
        <Button type="submit" size="lg" loading={busy} disabled={!online || count === 0}>
          {busy ? t("snd.sending") : count === 0 ? t("snd.send.none") : count === 1 ? t("snd.send.one") : t("snd.send", { n: count })}
        </Button>
        <Button variant="secondary" onClick={() => void copyLink()}>
          {copied === "done" ? t("snd.whatsapp.done") : t("snd.whatsapp")}
        </Button>
        {copied === "manual" && (
          <div className={s.manual}>
            <label className="field-label" htmlFor="snd-link">{t("snd.whatsapp.manual")}</label>
            <input id="snd-link" className="input" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
          </div>
        )}
        <p className={s.hint}>{t("snd.whatsapp.hint")}</p>
      </div>
    </form>
  );
}

function Results({ outcome, role, planId, onMore, nameById }: { outcome: SendOutcome; role: string; planId: string; onMore: () => void; nameById: Map<string, string> }) {
  const { t } = useI18n();
  const c = countResults(outcome.results);
  const title = c.sent === 0 ? t("snd.result.title.none") : c.sent === 1 ? t("snd.result.titleOne") : t("snd.result.title", { n: c.sent });
  return (
    <div className={s.wrap} data-testid="send-results">
      <div role="status">
        <h2 className={s.planName}>{title}</h2>
        <p className={s.sumLine}>{t("snd.result.totals", { sent: c.sent, already: c.already, skipped: c.skipped })}</p>
      </div>
      <ul className={s.resultList} aria-label={t("snd.result.list")}>
        {outcome.results.map((r) => {
          const name = nameById.get(r.memberId) ?? r.memberName;
          return (
            <li key={r.memberId} className={s.resultRow}>
              <div className={s.resultTop}>
                <span className={s.resultName}>{name}</span>
                <Badge tone={STATUS_TONE[r.status]}>{t(`snd.result.${r.status}` as MessageKey)}</Badge>
              </div>
              <p className={s.resultReason}>{t(`snd.result.${r.status}.reason` as MessageKey, { name: name.split(/\s+/)[0] ?? name })}</p>
            </li>
          );
        })}
      </ul>
      <div className={s.rowGap}>
        <Button variant="secondary" onClick={onMore}>{t("snd.result.more")}</Button>
        <ButtonLink variant="secondary" href={`/${role}/plans/${planId}/results`}>{t("snd.result.results")}</ButtonLink>
        <ButtonLink variant="ghost" href={`/${role}/plans`}>{t("snd.back")}</ButtonLink>
      </div>
    </div>
  );
}
