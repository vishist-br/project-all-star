import { en, type MessageKey } from "./messages/en";
import { hi } from "./messages/hi";
import { kn } from "./messages/kn";

export type { MessageKey };
export const LOCALES = ["en", "hi", "kn"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "locale";
/** Locales whose strings are drafts awaiting a native speaker. */
export const NEEDS_REVIEW: readonly Locale[] = ["hi", "kn"];

export const messages: Record<Locale, Record<MessageKey, string>> = { en, hi, kn };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

export function resolveLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export type Params = Record<string, string | number>;

export function translate(locale: Locale, key: MessageKey, params?: Params): string {
  const template = messages[locale][key] ?? en[key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) =>
    name in params ? String(params[name]) : m,
  );
}
