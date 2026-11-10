"use client";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { isRole } from "@/lib/nav";

type State = "working" | "invalid" | "missing" | "network";

/**
 * Landing page for /auth/magic?token=... The token is read once, removed from the address bar
 * at once, and exchanged through /auth/session, which sets httpOnly cookies. It is kept in
 * memory only so a network failure can be retried.
 */
export function MagicLanding() {
  const { t } = useI18n();
  const [state, setState] = useState<State>("working");
  const token = useRef<string | null>(null);
  const started = useRef(false);

  async function exchange() {
    setState("working");
    try {
      const res = await fetch("/auth/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: token.current }),
        credentials: "same-origin",
      });
      if (res.ok) {
        const body = (await res.json()) as { role?: string };
        token.current = null;
        // Full navigation so the new session's theme and shell load from the server.
        window.location.replace(isRole(body.role) ? `/${body.role}` : "/");
        return;
      }
      if (res.status >= 500) {
        setState("network");
      } else {
        token.current = null;
        setState("invalid");
      }
    } catch {
      setState("network");
    }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    token.current = new URLSearchParams(window.location.search).get("token");
    window.history.replaceState(null, "", window.location.pathname);
    if (!token.current) {
      setState("missing");
      return;
    }
    void exchange();
  }, []);

  return (
    <main className="page-pad auth-card" aria-live="polite">
      {state === "working" && <p>{t("signin.checking")}</p>}
      {state === "invalid" && (
        <section role="alert">
          <h1>{t("signin.invalid.title")}</h1>
          <p>{t("signin.invalid.body")}</p>
        </section>
      )}
      {state === "missing" && (
        <section role="alert">
          <h1>{t("signin.missing.title")}</h1>
          <p>{t("signin.missing.body")}</p>
        </section>
      )}
      {state === "network" && (
        <section role="alert">
          <h1>{t("signin.network.title")}</h1>
          <p>{t("signin.network.body")}</p>
          <button type="button" className="btn" onClick={() => void exchange()}>{t("signin.retry")}</button>
        </section>
      )}
    </main>
  );
}
