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

/** Tenant theme as CSS variables. Applied once at the document root. */
export function themeVars(theme: Pick<UiTheme, "primaryColor" | "secondaryColor" | "accentColor">) {
  return {
    "--primary": theme.primaryColor,
    "--primary-contrast": contrastColor(theme.primaryColor),
    "--secondary": theme.secondaryColor,
    "--accent": theme.accentColor ?? theme.primaryColor,
  } as CSSProperties;
}
