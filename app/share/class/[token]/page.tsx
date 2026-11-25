import type { Metadata } from "next";
import { SummaryBody } from "@/components/classes/SummaryBody";
import s from "@/components/classes/classes.module.css";
import { Card } from "@/components/ui/Card";
import { getSharedClassSummary } from "@/lib/api/class-summary";
import { ApiError } from "@/lib/auth/errors";
import { prisma } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { getThemeBySlug } from "@/lib/theme";
import { themeVars } from "@/lib/theme-ui";

export const dynamic = "force-dynamic";

/** Never indexed, no Referer leak of the token, and a generic title (no child name, no business detail). */
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("csm.share.page.metaTitle"), robots: { index: false, follow: false, noarchive: true }, referrer: "no-referrer" };
}

/**
 * Public class summary for families, behind an unguessable token (no sign-in), branded with the business theme.
 * Shows a first name only. An unknown, revoked or expired link shows one friendly notice.
 */
export default async function SharedClassPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { t } = await getT();
  let shared: Awaited<ReturnType<typeof getSharedClassSummary>> | null = null;
  try {
    shared = await getSharedClassSummary(token);
  } catch (err) {
    if (!(err instanceof ApiError) || err.code !== "not_found") throw err;
  }
  if (!shared) {
    return (
      <main className={s.unavailable}>
        <h1>{t("csm.share.page.unavailableTitle")}</h1>
        <p>{t("cs.share.expired")}</p>
      </main>
    );
  }
  const theme = await getThemeBySlug(prisma, shared.tenantSlug);
  return (
    <main className={s.pub} style={themeVars(theme)}>
      <div className={s.pubInner}>
        <div className={s.pubBrand}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {theme.logoUrl && <img className={s.pubLogo} src={theme.logoUrl} alt="" width={40} height={40} />}
          <p className={s.pubName}>{theme.displayName || shared.tenantName}</p>
        </div>
        <Card as="article" className={s.card}>
          <SummaryBody
            data={{
              titleKey: shared.titleKey,
              bodyKey: shared.bodyKey,
              params: shared.params,
              status: shared.status,
              coachNote: shared.coachNote,
              homePractice: shared.homePractice,
              workout: shared.workout,
            }}
            headingLevel={1}
          />
        </Card>
        <p className={s.pubFoot}>{t("csm.share.page.shared", { name: shared.tenantName })} · {t("csm.share.page.footnote")}</p>
      </div>
    </main>
  );
}
