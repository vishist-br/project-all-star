"use client";
import { useState, useTransition, type FormEvent } from "react";
import { addHolidayAction, removeHolidayAction } from "@/app/[role]/_actions/holidays";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DateInput, FormField, TextInput } from "@/components/ui/Form";
import { EmptyState } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import type { HolidayDto } from "@/lib/api/holidays";
import { useI18n } from "@/lib/i18n/client";
import s from "./holidays.module.css";
import { NAME_MAX, splitHolidays, validateHoliday, withHoliday, type HolidayError } from "./view-model";

/** Owner holiday and closure calendar: add a day, remove a day. Sessions on these days are not counted as missed. */
export function HolidayEditor({ initial, today }: { initial: HolidayDto[]; today: string }) {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [items, setItems] = useState(initial);
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [errors, setErrors] = useState<Partial<Record<"date" | "name", string>>>({});
  const [failure, setFailure] = useState<string | undefined>();

  const errText = (e: HolidayError) => t(`hol.err.${e}` as const, { max: NAME_MAX });
  const fmt = (d: string) =>
    new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
  const { upcoming, past } = splitHolidays(items, today);

  function onAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFailure(undefined);
    const check = validateHoliday({ date, name });
    if (!check.ok) {
      setErrors({ date: check.errors.date && errText(check.errors.date), name: check.errors.name && errText(check.errors.name) });
      return;
    }
    setErrors({});
    start(async () => {
      const res = await addHolidayAction(check.value);
      if (res.ok) {
        setItems((cur) => withHoliday(cur, res.data));
        setDate("");
        setName("");
        toast(t("hol.added"), "ok");
      } else if (res.code === "conflict") {
        setErrors({ date: t("hol.err.exists") });
      } else {
        const message = res.code === "forbidden" ? t("hol.forbidden") : t("hol.fail");
        setFailure(message);
        toast(message, "danger");
      }
    });
  }

  function onRemove(h: HolidayDto) {
    setFailure(undefined);
    start(async () => {
      const res = await removeHolidayAction(h.id);
      if (res.ok || res.code === "not_found") {
        setItems((cur) => cur.filter((x) => x.id !== h.id));
        toast(t("hol.removed"), "ok");
      } else {
        const message = res.code === "forbidden" ? t("hol.forbidden") : t("hol.fail");
        setFailure(message);
        toast(message, "danger");
      }
    });
  }

  const list = (rows: HolidayDto[]) => (
    <ul className={s.list}>
      {rows.map((h) => (
        <li key={h.id} className={s.row}>
          <span className={s.date}>{fmt(h.date)}</span>
          <span className={s.name}>{h.name}</span>
          <Button variant="ghost" disabled={pending} onClick={() => onRemove(h)} aria-label={t("hol.remove.label", { name: h.name, date: fmt(h.date) })}>
            {t("hol.remove")}
          </Button>
        </li>
      ))}
    </ul>
  );

  return (
    <div className={s.grid}>
      <Card title={t("hol.add.title")}>
        <form onSubmit={onAdd} noValidate className={s.form} aria-label={t("hol.add.title")}>
          <p className="muted small">{t("hol.intro")}</p>
          <FormField label={t("hol.date")} error={errors.date}>
            {(p) => <DateInput {...p} name="date" value={date} onChange={(e) => { setDate(e.target.value); setErrors((x) => ({ ...x, date: undefined })); }} />}
          </FormField>
          <FormField label={t("hol.name")} hint={t("hol.name.hint")} error={errors.name}>
            {(p) => <TextInput {...p} name="name" maxLength={NAME_MAX + 20} value={name} onChange={(e) => { setName(e.target.value); setErrors((x) => ({ ...x, name: undefined })); }} />}
          </FormField>
          {failure && <p className="field-error" role="alert">{failure}</p>}
          <div>
            <Button type="submit" loading={pending}>{t("hol.add")}</Button>
          </div>
        </form>
      </Card>
      <div className={s.lists}>
        <Card title={t("hol.upcoming")}>
          {upcoming.length ? list(upcoming) : <EmptyState title={t("hol.empty.title")} text={t("hol.empty.text")} />}
        </Card>
        {past.length > 0 && <Card title={t("hol.past")}>{list(past)}</Card>}
      </div>
    </div>
  );
}
