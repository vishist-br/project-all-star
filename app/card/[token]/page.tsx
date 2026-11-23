import type { Metadata } from "next";
import { CardView } from "@/components/progress-card/CardView";
import s from "@/components/progress-card/progress-card.module.css";
import { loadSharedCard } from "@/lib/api/progress-card";
import { ApiError } from "@/lib/auth/errors";
import { prisma } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { getThemeForTenant } from "@/lib/theme";
import { themeVars } from "@/lib/theme-ui";

export const dynamic = "force-dynamic";

/** Never indexed, never leaks the token in a Referer header. The title is generic (no child name). */
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("pc.public.title"), robots: { index: false, follow: false, noarchive: true }, referrer: "no-referrer" };
}

/**
 * Public weekly card behind an unguessable token (no sign-in). Shows a first name only, no photo.
 * A bad, revoked or expired token all show the same "not available" notice.
 */
export default async function SharedCardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { t } = await getT();
  let shared: Awaited<ReturnType<typeof loadSharedCard>> | null = null;
  try {
    shared = await loadSharedCard(prisma, token);
  } catch (err) {
    if (!(err instanceof ApiError) || err.code !== "not_found") throw err;
  }
  if (!shared) {
    return (
      <main className={s.unavailable}>
        <h1>{t("pc.public.unavailable.title")}</h1>
        <p>{t("pc.public.unavailable.body")}</p>
      </main>
    );
  }
  const theme = await getThemeForTenant(prisma, shared.tenantId);
  return (
    <main className={s.pub} style={themeVars(theme)}>
      <CardView card={shared.card} />
      <p className={s.meta} style={{ textAlign: "center", marginTop: "1rem" }}>{t("pc.public.sharedBy", { name: shared.card.tenantName })}</p>
    </main>
  );
}
