import type { MessageKey, Params } from "@/lib/i18n";
import type { ActionError } from "@/lib/plans/result";
import type { SessionWarning } from "@/lib/sessions/types";
import s from "./sessions.module.css";

type T = (key: MessageKey, params?: Params) => string;

/** Non-blocking notices from the API (outside availability, holiday, over capacity), in friendly words. */
export function WarningList({ warnings, t }: { warnings: readonly SessionWarning[]; t: T }) {
  if (warnings.length === 0) return null;
  return (
    <ul className={s.warnList} aria-label={t("sess.warn.title")}>
      {warnings.map((w) => (
        <li key={w.code} className={s.warn}>{t(`sess.warn.${w.code}` as MessageKey)}</li>
      ))}
    </ul>
  );
}

/** Friendly text for a failed server action. Overlaps (409) get their own message. */
export function describeError(t: T, res: ActionError): string {
  switch (res.code) {
    case "conflict":
      if (/overlap|already exists at this time/i.test(res.message)) return t("sess.err.overlap");
      if (/not started yet/i.test(res.message)) return t("sess.err.notStarted");
      if (/completed session|cancelled session|cancelled/i.test(res.message)) return t("sess.err.locked");
      return t("sess.err.conflict");
    case "validation_failed":
      return t("sess.err.validation", { detail: res.details?.[0]?.message ?? res.message });
    case "forbidden":
    case "not_found":
      return t("sess.err.notYours");
    case "unauthorized":
      return t("sess.err.signedOut");
    default:
      return t("sess.err.generic");
  }
}
