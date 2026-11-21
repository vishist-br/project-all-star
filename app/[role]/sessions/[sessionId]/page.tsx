import { notFound } from "next/navigation";
import { RollCall } from "@/components/sessions/RollCall";
import { SessionManage } from "@/components/sessions/SessionManage";
import s from "@/components/sessions/sessions.module.css";
import { Badge, type Tone } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { ErrorState } from "@/components/ui/States";
import { getSession } from "@/lib/api/session-detail";
import { ApiError } from "@/lib/auth/errors";
import { checkRole } from "@/lib/auth/guard";
import type { MessageKey } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { isRole } from "@/lib/nav";
import type { SessionDetail } from "@/lib/sessions/types";
import { formatDay, istDate, istTime } from "@/lib/sessions/week";
import { getViewer } from "@/lib/viewer";

const TONE: Record<string, Tone> = { scheduled: "info", completed: "ok", cancelled: "neutral" };

/** Roll call for one session. A coach reaches only their own sessions (the API answers 403/404 otherwise); a customer never gets here. */
export default async function SessionPage({ params }: { params: Promise<{ role: string; sessionId: string }> }) {
  const { role, sessionId } = await params;
  if (!isRole(role) || role === "customer") notFound();
  const { t, locale } = await getT();
  const { db, principal } = await getViewer();
  if (principal.role === "customer") notFound();
  checkRole(principal, "getSession");

  let detail: SessionDetail | null = null;
  try {
    detail = (await getSession(db, principal, sessionId)) as unknown as SessionDetail;
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    if (err.code === "not_found" || err.code === "forbidden") notFound();
  }

  const back = <ButtonLink variant="ghost" href={`/${role}/today`}>{t("sess.back")}</ButtonLink>;
  if (!detail) {
    return (
      <>
        <PageHeader title={t("sess.title")} actions={back} />
        <ErrorState title={t("ui.errorTitle")} message={t("today.loadError")} />
      </>
    );
  }
  const date = formatDay(istDate(detail.startsAt), locale, { weekday: "long", day: "numeric", month: "long" });
  return (
    <>
      <PageHeader
        title={detail.title ?? detail.batchName}
        subtitle={`${date} · ${istTime(detail.startsAt)} – ${istTime(detail.endsAt)} · ${detail.venueName}`}
        actions={back}
      />
      <div className={s.sessionHead}>
        <div className={s.chips}>
          <Badge tone={TONE[detail.status] ?? "neutral"}>{t(`card.status.${detail.status}` as MessageKey)}</Badge>
          <Badge tone="neutral">{t(detail.kind === "one_on_one" ? "card.oneOnOne" : "card.group")}</Badge>
          {detail.kind === "group_class" && detail.capacity !== null && (
            <Badge tone="neutral">{t("card.booked", { booked: detail.bookedCount, capacity: detail.capacity })}</Badge>
          )}
          {detail.waitlistCount > 0 && <Badge tone="info">{t("card.waitlist", { n: detail.waitlistCount })}</Badge>}
        </div>
        {principal.role === "coach" && <SessionManage detail={detail} />}
      </div>
      {detail.status === "cancelled" ? (
        <p className={s.warn} role="status">
          {t("sess.cancelled")}
          {detail.cancelReason ? ` ${detail.cancelReason}` : ""}
        </p>
      ) : (
        <RollCall detail={detail} userId={principal.userId} />
      )}
    </>
  );
}
