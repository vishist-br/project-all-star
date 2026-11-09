"use client";
import { useRouter } from "next/navigation";
import { LOCALES, LOCALE_COOKIE, isLocale, type MessageKey } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";

export function LanguageSwitcher() {
  const { locale, t } = useI18n();
  const router = useRouter();

  function change(value: string) {
    if (!isLocale(value)) return;
    document.cookie = `${LOCALE_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }

  return (
    <label className="lang-switcher">
      <span className="sr-only">{t("lang.label")}</span>
      <select value={locale} onChange={(e) => change(e.target.value)} aria-label={t("lang.label")}>
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {t(`lang.${l}` as MessageKey)}
          </option>
        ))}
      </select>
    </label>
  );
}
