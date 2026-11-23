"use client";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { createCardLinkAction, revokeCardLinkAction } from "@/app/[role]/_actions/progress-card";
import { Button, Card, useToast } from "@/components/ui";
import { formatDay } from "@/lib/customer/format";
import { useI18n } from "@/lib/i18n/client";
import s from "./progress-card.module.css";

export type LiveLink = { id: string; weekStart: string; expiresAt: string };

/**
 * Share and print the card. "Create share link" makes an unguessable same-origin link
 * (`<this site>/card/<token>`) that anyone can open without signing in; it shows only a first name,
 * no photos. The full link is visible once, here; later only the list with "Turn off" remains.
 */
export function ShareControls({ memberId, weekStart, links }: { memberId: string; weekStart: string; links: LiveLink[] }) {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [created, setCreated] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  function create() {
    start(async () => {
      const res = await createCardLinkAction(memberId, weekStart);
      if (!res.ok) {
        toast(res.code === "conflict" ? t("pc.share.limit") : t("pc.share.err"), "warn");
        return;
      }
      setCreated(`${window.location.origin}${res.data.path}`);
      toast(t("pc.share.created"), "ok");
      router.refresh();
    });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(created ?? "");
      toast(t("pc.share.copied"), "ok");
    } catch {
      input.current?.select();
      toast(t("pc.share.copyFailed"), "warn");
    }
  }

  function revoke(id: string) {
    start(async () => {
      const res = await revokeCardLinkAction(id);
      toast(res.ok ? t("pc.share.revoked") : t("pc.share.err"), res.ok ? "ok" : "warn");
      router.refresh();
    });
  }

  return (
    <div className={`${s.noPrint}`}>
      <Card title={t("pc.share.title")}>
        <div className={s.share}>
          <p className="muted">{t("pc.share.privacy")}</p>
          <div className={s.linkRow}>
            <Button loading={pending} onClick={create} data-testid="create-link">{t("pc.share.create")}</Button>
            <Button variant="secondary" onClick={() => window.print()}>{t("pc.share.print")}</Button>
          </div>
          {created && (
            <div className={s.share} role="status">
              <label className="field-label" htmlFor="card-link">{t("pc.share.linkLabel")}</label>
              <div className={s.linkRow}>
                <input id="card-link" className="input" ref={input} readOnly value={created} onFocus={(e) => e.currentTarget.select()} data-testid="card-link" />
                <Button variant="secondary" onClick={copy}>{t("pc.share.copy")}</Button>
              </div>
              <p className="muted">{t("pc.share.oneTime")}</p>
            </div>
          )}
          <h3 className="field-label">{t("pc.share.live")}</h3>
          {links.length === 0 ? (
            <p className="muted">{t("pc.share.none")}</p>
          ) : (
            <ul className={s.live} data-testid="live-links">
              {links.map((l) => (
                <li key={l.id}>
                  <span>
                    {t("pc.share.liveItem", { week: formatDay(l.weekStart, locale) })}
                    <br />
                    <small className="muted">{t("pc.share.expires", { date: formatDay(l.expiresAt.slice(0, 10), locale) })}</small>
                  </span>
                  <Button variant="secondary" loading={pending} onClick={() => revoke(l.id)}>{t("pc.share.revoke")}</Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
