"use client";
import { useState, useTransition, type FormEvent } from "react";
import { addCredentialAction, removeCredentialAction, setCredentialVerifiedAction } from "@/app/[role]/_actions/credentials";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FormField, TextInput } from "@/components/ui/Form";
import { useToast } from "@/components/ui/Toast";
import type { CredentialDto } from "@/lib/api/coach-credentials";
import { useI18n } from "@/lib/i18n/client";
import { ISSUER_MAX, TITLE_MAX, YEAR_MIN, sortCredentials, validateCredential, type CredentialError } from "./view-model";

/**
 * Credential badges with controls. The owner verifies or unverifies and can remove; the coach adds
 * their own claimed credentials (shown unverified until the owner verifies) and can remove them.
 */
export function CredentialManager({ coachId, initial, canVerify, canAdd, thisYear }: { coachId: string; initial: CredentialDto[]; canVerify: boolean; canAdd: boolean; thisYear: number }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [items, setItems] = useState(initial);
  const [title, setTitle] = useState("");
  const [issuer, setIssuer] = useState("");
  const [year, setYear] = useState("");
  const [errors, setErrors] = useState<Partial<Record<"title" | "year", string>>>({});
  const [failure, setFailure] = useState<string | undefined>();

  const errText = (e: CredentialError) => t(`cred.err.${e}` as const, { max: TITLE_MAX, min: YEAR_MIN });
  const message = (code: string) => (code === "forbidden" ? t("cred.forbidden") : code === "conflict" ? t("cred.err.limit") : t("cred.fail"));

  function onAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFailure(undefined);
    const check = validateCredential({ title, issuer, year }, thisYear);
    if (!check.ok) {
      setErrors({ title: check.errors.title && errText(check.errors.title), year: check.errors.year && errText(check.errors.year) });
      return;
    }
    setErrors({});
    start(async () => {
      const res = await addCredentialAction(coachId, check.value);
      if (res.ok) {
        setItems((cur) => [...cur, res.data]);
        setTitle("");
        setIssuer("");
        setYear("");
        toast(t("cred.added"), "ok");
      } else {
        setFailure(message(res.code));
        toast(message(res.code), "danger");
      }
    });
  }

  function onVerify(c: CredentialDto, verified: boolean) {
    setFailure(undefined);
    start(async () => {
      const res = await setCredentialVerifiedAction(c.id, verified);
      if (res.ok) {
        setItems((cur) => cur.map((x) => (x.id === c.id ? res.data : x)));
        toast(t("cred.updated"), "ok");
      } else {
        setFailure(message(res.code));
        toast(message(res.code), "danger");
      }
    });
  }

  function onRemove(c: CredentialDto) {
    setFailure(undefined);
    start(async () => {
      const res = await removeCredentialAction(c.id);
      if (res.ok || res.code === "not_found") {
        setItems((cur) => cur.filter((x) => x.id !== c.id));
        toast(t("cred.removed"), "ok");
      } else {
        setFailure(message(res.code));
        toast(message(res.code), "danger");
      }
    });
  }

  return (
    <div style={{ display: "grid", gap: "var(--s3)", minWidth: 0 }}>
      <p className="muted small">{canVerify ? t("cred.intro.owner") : t("cred.intro.coach")}</p>
      {items.length === 0 ? (
        <p className="muted small">{t("cred.empty")}</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "var(--s3)" }}>
          {sortCredentials(items).map((c) => (
            <li key={c.id} data-testid="credential" style={{ display: "grid", gap: "var(--s2)", minWidth: 0 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--s2)", alignItems: "center" }}>
                <Badge tone={c.verified ? "ok" : "neutral"}>{c.verified ? t("cred.verified") : t("cred.unverified")}</Badge>
                <strong style={{ overflowWrap: "anywhere" }}>{c.title}</strong>
                <span className="muted small">
                  {[c.issuer ? t("cred.issuedBy", { issuer: c.issuer }) : null, c.year ? t("cred.year", { year: c.year }) : null].filter(Boolean).join(" · ")}
                </span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--s2)" }}>
                {canVerify && (
                  <Button
                    variant="secondary"
                    disabled={pending}
                    onClick={() => onVerify(c, !c.verified)}
                    aria-label={t(c.verified ? "cred.unverify.label" : "cred.verify.label", { title: c.title })}
                  >
                    {c.verified ? t("cred.unverify") : t("cred.verify")}
                  </Button>
                )}
                <Button variant="ghost" disabled={pending} onClick={() => onRemove(c)} aria-label={t("cred.remove.label", { title: c.title })}>
                  {t("cred.remove")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {canAdd && (
        <form onSubmit={onAdd} noValidate aria-label={t("cred.add.title")} style={{ display: "grid", gap: "var(--s3)" }}>
          <strong>{t("cred.add.title")}</strong>
          <FormField label={t("cred.add.name")} error={errors.title}>
            {(p) => <TextInput {...p} name="title" maxLength={TITLE_MAX + 20} value={title} onChange={(e) => { setTitle(e.target.value); setErrors((x) => ({ ...x, title: undefined })); }} />}
          </FormField>
          <FormField label={t("cred.add.issuer")}>
            {(p) => <TextInput {...p} name="issuer" maxLength={ISSUER_MAX} value={issuer} onChange={(e) => setIssuer(e.target.value)} />}
          </FormField>
          <FormField label={t("cred.add.year")} error={errors.year}>
            {(p) => <TextInput {...p} name="year" inputMode="numeric" maxLength={4} value={year} onChange={(e) => { setYear(e.target.value); setErrors((x) => ({ ...x, year: undefined })); }} />}
          </FormField>
          {failure && <p className="field-error" role="alert">{failure}</p>}
          <div>
            <Button type="submit" loading={pending}>{t("cred.add")}</Button>
          </div>
        </form>
      )}
      {!canAdd && failure && <p className="field-error" role="alert">{failure}</p>}
    </div>
  );
}
