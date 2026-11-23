import { Badge } from "@/components/ui/Badge";
import type { CredentialDto } from "@/lib/api/coach-credentials";
import type { Params, MessageKey } from "@/lib/i18n";
import { sortCredentials } from "./view-model";

/** Read-only list of credential badges (members, owner list). Status is always in the text, never colour alone. */
export function CredentialBadges({ items, t }: { items: CredentialDto[]; t: (key: MessageKey, params?: Params) => string }) {
  if (items.length === 0) return <p className="muted small">{t("cred.empty")}</p>;
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "var(--s2)" }}>
      {sortCredentials(items).map((c) => (
        <li key={c.id} data-testid="credential" style={{ display: "flex", flexWrap: "wrap", gap: "var(--s2)", alignItems: "center", minWidth: 0 }}>
          <Badge tone={c.verified ? "ok" : "neutral"}>{c.verified ? t("cred.verified") : t("cred.unverified")}</Badge>
          <strong style={{ overflowWrap: "anywhere" }}>{c.title}</strong>
          <span className="muted small">
            {[c.issuer ? t("cred.issuedBy", { issuer: c.issuer }) : null, c.year ? t("cred.year", { year: c.year }) : null].filter(Boolean).join(" · ")}
          </span>
        </li>
      ))}
    </ul>
  );
}
