"use client";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/client";
import { ROLES, type Role } from "@/lib/nav";
import { DEMO_ROLE_COOKIE, DEMO_TENANT_COOKIE } from "@/lib/demo";

function setCookie(name: string, value: string) {
  document.cookie = `${name}=${value}; path=/; max-age=31536000; samesite=lax`;
}

/** Dev/demo only. The server renders this only when isDemoMode() is true. */
export function DemoSwitcher({
  tenants,
  tenantSlug,
  role,
}: {
  tenants: { tenantSlug: string; displayName: string }[];
  tenantSlug: string;
  role: Role;
}) {
  const { t } = useI18n();
  const router = useRouter();

  return (
    <div className="demo-switcher" role="group" aria-label={t("demo.label")}>
      <strong>{t("demo.label")}</strong>
      <label>
        <span>{t("demo.tenant")}</span>
        <select
          value={tenantSlug}
          onChange={(e) => {
            setCookie(DEMO_TENANT_COOKIE, e.target.value);
            router.refresh();
          }}
        >
          {tenants.map((x) => (
            <option key={x.tenantSlug} value={x.tenantSlug}>{x.displayName}</option>
          ))}
        </select>
      </label>
      <label>
        <span>{t("demo.role")}</span>
        <select
          value={role}
          onChange={(e) => {
            setCookie(DEMO_ROLE_COOKIE, e.target.value);
            router.refresh();
          }}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>{t(`role.${r}`)}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
