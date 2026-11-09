import type { ReactNode } from "react";
import "./globals.css";
import { getLocale } from "@/lib/i18n/server";
import { I18nProvider } from "@/lib/i18n/client";
import { getSession, isDemoMode } from "@/lib/session";
import { themeVars } from "@/lib/theme-ui";
import { DemoSwitcher } from "@/components/DemoSwitcher";

// Tab title is the business's own name (white-label), from the tenant theme.
export async function generateMetadata() {
  const { theme } = await getSession();
  return { title: theme.displayName };
}
export const viewport = { width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const session = await getSession();
  return (
    <html lang={locale} style={themeVars(session.theme)}>
      <body>
        <I18nProvider locale={locale}>
          {children}
          {isDemoMode() && <DemoSwitcher tenantSlug={session.tenantSlug} role={session.role} />}
        </I18nProvider>
      </body>
    </html>
  );
}
