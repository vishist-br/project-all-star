"use client";
import { useState, useTransition, type FormEvent } from "react";
import { saveBookingRulesAction } from "@/app/[role]/_actions/settings";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormField, TextInput, Toggle } from "@/components/ui/Form";
import { useToast } from "@/components/ui/Toast";
import { useI18n } from "@/lib/i18n/client";
import s from "./settings.module.css";
import { MAX_CANCEL_MINUTES, parseCancelWindow, splitMinutes, type BookingRules } from "./view-model";

/** Editable booking rules. Saves through a server action; shows inline validation, a success toast and an error banner. */
export function BookingRulesForm({ initial }: { initial: BookingRules }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [minutes, setMinutes] = useState(String(initial.bookingCancelWindowMinutes));
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [failure, setFailure] = useState<string | undefined>();

  const parsed = parseCancelWindow(minutes);
  const summary = parsed.ok ? splitMinutes(parsed.value) : null;

  function errorText(code: "required" | "integer" | "range") {
    return t(`bk.err.${code}` as const);
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setFailure(undefined);
    const check = parseCancelWindow(minutes);
    if (!check.ok) {
      setFieldError(errorText(check.error));
      return;
    }
    setFieldError(undefined);
    start(async () => {
      const res = await saveBookingRulesAction({ cancelWindow: minutes, waitlistEnabled: form.get("waitlist") === "on", showMissedSessionCost: form.get("cost") === "on" });
      if (res.ok) {
        setMinutes(String(res.data.bookingCancelWindowMinutes));
        toast(t("bk.saved"), "ok");
      } else if (res.code === "validation_failed") {
        setFieldError(errorText("range"));
      } else {
        const message = res.code === "forbidden" ? t("bk.forbidden") : t("bk.fail");
        setFailure(message);
        toast(message, "danger");
      }
    });
  }

  return (
    <Card title={t("bk.title")}>
      <form onSubmit={onSubmit} noValidate className={s.form} aria-label={t("bk.title")}>
        <p className="muted small">{t("bk.intro")}</p>
        <FormField label={t("bk.cancel.label")} hint={t("bk.cancel.hint")} error={fieldError}>
          {(p) => (
            <TextInput
              {...p}
              name="cancelWindow"
              type="number"
              inputMode="numeric"
              min={0}
              max={MAX_CANCEL_MINUTES}
              step={1}
              value={minutes}
              onChange={(e) => {
                setMinutes(e.target.value);
                setFieldError(undefined);
              }}
            />
          )}
        </FormField>
        {summary && <p className="field-hint">{t("bk.cancel.summary", { hours: summary.hours, minutes: summary.minutes })}</p>}
        <Toggle key={`w-${initial.waitlistEnabled}`} name="waitlist" label={t("bk.waitlist.label")} defaultChecked={initial.waitlistEnabled} />
        <div>
          <Toggle key={`c-${initial.showMissedSessionCost}`} name="cost" label={t("bk.cost.label")} defaultChecked={initial.showMissedSessionCost} />
          <p className="field-hint">{t("bk.cost.hint")}</p>
        </div>
        {failure && (
          <p className="field-error" role="alert">
            {failure}
          </p>
        )}
        <div>
          <Button type="submit" loading={pending}>
            {t("bk.save")}
          </Button>
        </div>
      </form>
    </Card>
  );
}
