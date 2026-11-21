import type { Locale, MessageKey, Params } from "../i18n";
import { formatWhen } from "./format";

export type FeedUpdate = {
  id: string;
  kind: string;
  params: Record<string, string>;
  createdAt: string;
  read: boolean;
};

type T = (key: MessageKey, params?: Params) => string;

export type UpdateView = {
  /** The sentence, from i18n (never the English fallback `title` of the API). */
  text: string;
  /** Coach's own words, when the update carries them. */
  note: string | null;
  category: "plan" | "goal" | "session" | "booking" | "other";
};

const CATEGORY: Record<string, UpdateView["category"]> = {
  plan_assigned: "plan",
  plan_updated: "plan",
  plan_ended: "plan",
  goal_set: "goal",
  goal_updated: "goal",
  session_scheduled: "session",
  session_rescheduled: "session",
  session_cancelled: "session",
  booking_confirmed: "booking",
  waitlist_promoted: "booking",
};

/** Renders an update from its kind and params. Unknown kinds get a friendly generic line. */
export function describeUpdate(u: Pick<FeedUpdate, "kind" | "params">, t: T, locale: Locale): UpdateView {
  const p = u.params;
  const plan = p.planTitle || t("upd.yourPlan");
  const goal = p.goalTitle || t("upd.yourGoal");
  const batch = p.batchName || t("upd.aSession");
  const when = p.startsAt ? formatWhen(p.startsAt, locale) : [p.date, p.time].filter(Boolean).join(" ") || t("upd.soon");
  const category = CATEGORY[u.kind] ?? "other";
  const note = p.note && p.note.trim() ? p.note.trim() : null;
  const make = (text: string, withNote = false): UpdateView => ({ text, note: withNote ? note : null, category });
  switch (u.kind) {
    case "plan_assigned":
      return make(t("upd.plan_assigned", { plan }), true);
    case "plan_updated":
      return make(p.status === "paused" ? t("upd.plan_paused", { plan }) : t("upd.plan_updated", { plan }));
    case "plan_ended":
      return make(t("upd.plan_ended", { plan }));
    case "goal_set":
      return make(t("upd.goal_set", { goal }));
    case "goal_updated":
      return make(p.status === "achieved" ? t("upd.goal_achieved", { goal }) : t("upd.goal_updated", { goal }));
    case "session_scheduled":
      return make(t("upd.session_scheduled", { batch, when }));
    case "session_rescheduled":
      return make(t("upd.session_rescheduled", { batch, when }));
    case "session_cancelled":
      return make(
        p.reason === "holiday"
          ? t("upd.session_cancelled_holiday", { batch, when })
          : p.reason === "coach_unavailable"
            ? t("upd.session_cancelled_coach", { batch, when })
            : t("upd.session_cancelled", { batch, when }),
      );
    case "booking_confirmed":
      return make(t("upd.booking_confirmed", { batch, when }));
    case "waitlist_promoted":
      return make(t("upd.waitlist_promoted", { batch, when }));
    default:
      return make(t("upd.generic"));
  }
}

/** The `upTo` for markMemberUpdatesRead: the newest createdAt in the feed (null for an empty feed). */
export function newestCreatedAt(items: readonly Pick<FeedUpdate, "createdAt">[]): string | null {
  let best: string | null = null;
  for (const i of items) if (best === null || new Date(i.createdAt).getTime() > new Date(best).getTime()) best = i.createdAt;
  return best;
}
