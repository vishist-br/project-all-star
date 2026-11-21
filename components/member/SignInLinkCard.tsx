"use client";
import { useState } from "react";
import { createSignInLinkAction } from "@/app/[role]/_actions/members";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import { useI18n } from "@/lib/i18n/client";
import type { MemberMagicLinkDto } from "@/lib/auth/member-link";
import s from "./member.module.css";

/**
 * Creates a one-time sign-in link for the member (or their guardian). The link is kept only in
 * this component's state: shown once with a copy button and the 15-minute note, never stored.
 */
export function SignInLinkCard({ memberId }: { memberId: string }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<MemberMagicLinkDto | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setProblem(null);
    const res = await createSignInLinkAction(memberId);
    setBusy(false);
    if (res.ok) setLink(res.data);
    else setProblem(res.code === "not_found" ? t("member.signin.noAccount") : t("member.signin.error"));
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      toast(t("member.signin.copied"));
    } catch {
      toast(t("member.signin.copyFailed"), "warn");
    }
  }

  return (
    <Card title={t("member.signin.title")}>
      <div className={s.linkBox}>
        {!link && <p className="muted">{t("member.signin.text")}</p>}
        {problem && <p className="msg-error" role="alert">{problem}</p>}
        {link && (
          <>
            <p><strong>{t("member.signin.ready", { recipient: t(`member.signin.recipient.${link.recipient}` as "member.signin.recipient.member") })}</strong></p>
            <div className="field">
              <label className="field-label" htmlFor="signin-link">{t("member.signin.field")}</label>
              <input id="signin-link" className={`input ${s.linkField}`} readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} />
            </div>
            <p className={s.expiry} role="note">{t("member.signin.expiry")}</p>
            <div className={s.actions}>
              <Button onClick={() => void copy()}>{t("member.signin.copy")}</Button>
              <Button variant="secondary" onClick={() => setLink(null)}>{t("member.signin.hide")}</Button>
            </div>
          </>
        )}
        {!link && (
          <div className={s.actions}>
            <Button loading={busy} onClick={() => void create()}>{t("member.signin.create")}</Button>
          </div>
        )}
      </div>
    </Card>
  );
}
