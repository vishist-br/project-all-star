import type { CSSProperties } from "react";
import type { MockTheme } from "./mock-session";

/** Tenant theme as CSS variables. Applied once at the document root. */
export function themeVars(theme: Pick<MockTheme, "primaryColor" | "secondaryColor" | "accentColor">) {
  return {
    "--primary": theme.primaryColor,
    "--secondary": theme.secondaryColor,
    "--accent": theme.accentColor ?? theme.primaryColor,
  } as CSSProperties;
}
