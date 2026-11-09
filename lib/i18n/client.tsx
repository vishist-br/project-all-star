"use client";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { translate, type Locale, type MessageKey, type Params } from "./index";

type Ctx = { locale: Locale; t: (key: MessageKey, params?: Params) => string };
const I18nContext = createContext<Ctx | null>(null);

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo<Ctx>(
    () => ({ locale, t: (key, params) => translate(locale, key, params) }),
    [locale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): Ctx {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}
