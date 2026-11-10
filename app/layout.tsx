import type { ReactNode } from "react";
import "./globals.css";
import { getLocale } from "@/lib/i18n/server";
import { I18nProvider } from "@/lib/i18n/client";
import { getSessionOrNull, getThemeOrNeutral, isDemoMode, listDemoTenants } from "@/lib/session";
import { themeVars } from "@/lib/theme-ui";
import { DemoSwitcher } from "@/components/DemoSwitcher";

// Tab title is the business's own name (white-label), from the tenant theme.
export async function generateMetadata() {
  const theme = await getThemeOrNeutral();
  return theme.displayName ? { title: theme.displayName } : {};
}
export const viewport = { width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const session = await getSessionOrNull();
  const theme = await getThemeOrNeutral();
  // The switcher is for demos only, and is hidden once someone is really signed in.
  const demoTenants = isDemoMode() && session?.source !== "real" ? await listDemoTenants() : null;
  return (
    <html lang={locale} style={themeVars(theme)}>
      <body>
        <I18nProvider locale={locale}>
          {children}
          {demoTenants && session && (
            <DemoSwitcher tenants={demoTenants} tenantSlug={session.tenantSlug} role={session.role} />
          )}
        </I18nProvider>
      </body>
    </html>
  );
}
