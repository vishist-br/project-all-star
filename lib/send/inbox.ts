import type { Locale, MessageKey, Params } from "../i18n";
import { formatDay } from "../customer/format";
import { coachLabel } from "./view";

type T = (key: MessageKey, params?: Params) => string;

export type InboxUpdate = { id: string; kind: string; entityType: string; entityId: string; actorName: string | null; params: Record<string, string>; createdAt: string; read: boolean };
export type InboxAssignment = { id: string; planId: string; planTitle: string; startsOn: string; endsOn: string | null; note: string | null; status: string };
export type InboxPlan = { id: string; title: string; days: { items: { exerciseName: string }[] }[] };

export type InboxCard = {
  updateId: string;
  createdAt: string;
  tag: string;
  planTitle: string;
  scheduleLine: string;
  exerciseCountText: string;
  note: string | null;
  exercises: string[];
};

/** New plans from the coach that the member has not opened yet, newest first, at most `max`. */
export function buildInboxCards(
  updates: readonly InboxUpdate[],
  assignments: readonly InboxAssignment[],
  plans: ReadonlyMap<string, InboxPlan>,
  t: T,
  locale: Locale,
  today: string,
  max = 3,
): InboxCard[] {
  const byId = new Map(assignments.map((a) => [a.id, a]));
  const cards: InboxCard[] = [];
  const seen = new Set<string>();
  const fresh = [...updates].filter((u) => u.kind === "plan_assigned" && u.entityType === "assignment" && !u.read).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const u of fresh) {
    if (seen.has(u.entityId)) continue;
    const a = byId.get(u.entityId);
    if (a && a.status === "ended") continue; // the plan has finished: nothing to start
    seen.add(u.entityId);
    const plan = a ? plans.get(a.planId) : undefined;
    const title = a?.planTitle ?? u.params.planTitle ?? "";
    const start = a?.startsOn ?? u.params.startsOn ?? null;
    const exercises = [...new Set((plan?.days ?? []).flatMap((d) => d.items.map((i) => i.exerciseName)))];
    const count = exercises.length;
    const schedule = !start
      ? ""
      : a?.endsOn
        ? t("ib.schedule.ends", { start: formatDay(start, locale), end: formatDay(a.endsOn, locale) })
        : start > today
          ? t("ib.schedule.starts", { date: formatDay(start, locale) })
          : t("ib.schedule.startedOn", { date: formatDay(start, locale) });
    const noteRaw = u.params.note ?? a?.note ?? "";
    cards.push({
      updateId: u.id,
      createdAt: u.createdAt,
      tag: u.actorName ? t("ib.tag", { coach: coachLabel(u.actorName) }) : t("ib.tagNoName"),
      planTitle: title,
      scheduleLine: schedule,
      exerciseCountText: count > 0 ? t(count === 1 ? "ib.exercises.one" : "ib.exercises.other", { n: count }) : "",
      note: noteRaw.trim() ? noteRaw.trim() : null,
      exercises,
    });
    if (cards.length >= max) break;
  }
  return cards;
}
