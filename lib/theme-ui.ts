import type { CSSProperties } from "react";
import { contrastRatio, type TenantTheme } from "./theme";

/** What the UI needs of a tenant theme (the TenantTheme API shape without the locale). */
export type UiTheme = Omit<TenantTheme, "defaultLocale">;

/** Used where no tenant is known (sign-in pages with no session). No business name, no builder branding. */
export const NEUTRAL_THEME: UiTheme = {
  tenantSlug: "",
  displayName: "",
  logoUrl: null,
  primaryColor: "#1F6FEB",
  secondaryColor: "#0B1F3A",
  accentColor: null,
};

/** White or near-black, whichever reads better on the colour (text on primary buttons and chips). */
export function contrastColor(hex: string): string {
  return contrastRatio(hex, "#FFFFFF") >= contrastRatio(hex, "#111111") ? "#FFFFFF" : "#111111";
}

function toRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function toHex([r, g, b]: [number, number, number]): string {
  return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("").toUpperCase();
}
function mix(a: string, b: string, weightA: number): string {
  const [x, y] = [toRgb(a), toRgb(b)];
  return toHex([0, 1, 2].map((i) => x[i] * weightA + y[i] * (1 - weightA)) as [number, number, number]);
}

/**
 * Text-safe version of the tenant colour for a given background: the brand colour itself when it already reads
 * at 4.5:1 (also on its own 12% tint, used for hover and selected states), otherwise moved toward black (light
 * backgrounds) or white (dark backgrounds) until it does. Brand fills keep the tenant colour untouched.
 */
export function accessibleTextColor(hex: string, background: string): string {
  const toward = luminanceOf(background) > 0.4 ? "#000000" : "#FFFFFF";
  const ok = (c: string) => contrastRatio(c, background) >= 4.6 && contrastRatio(c, mix(hex, background, 0.12)) >= 4.5;
  for (let i = 0; i <= 20; i++) {
    const c = mix(toward, hex, i / 20);
    if (ok(c)) return c;
  }
  return toward;
}
function luminanceOf(hex: string): number {
  return contrastRatio(hex, "#000000") / 21;
}

/** Tenant theme as CSS variables. Applied once at the document root. */
export function themeVars(theme: Pick<UiTheme, "primaryColor" | "secondaryColor" | "accentColor">) {
  return {
    "--primary": theme.primaryColor,
    "--primary-contrast": contrastColor(theme.primaryColor),
    // Primary used as text: light and dark page backgrounds (globals.css picks one per colour scheme).
    "--primary-text-l": accessibleTextColor(theme.primaryColor, "#FFFFFF"),
    "--primary-text-d": accessibleTextColor(theme.primaryColor, "#181C24"),
    "--secondary": theme.secondaryColor,
    "--accent": theme.accentColor ?? theme.primaryColor,
  } as CSSProperties;
}
