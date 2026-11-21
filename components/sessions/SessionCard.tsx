import { Badge, type Tone } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { MessageKey, Params } from "@/lib/i18n";
import type { SessionDto } from "@/lib/api/sessions";
import { istTime } from "@/lib/sessions/week";
import s from "./sessions.module.css";

type T = (key: MessageKey, params?: Params) => string;
const TONE: Record<string, Tone> = { scheduled: "info", completed: "ok", cancelled: "neutral" };

/** One session: time, name, venue, booked and waitlist counts, status and a link to the roll call. */
export function SessionCard({ session, venue, role, t }: { session: SessionDto; venue?: string; role: string; t: T }) {
  const sum = session.attendanceSummary;
  const open = session.status === "scheduled";
  return (
    <Card as="li" className={s.sessionCard}>
      <div className={s.sessionTop}>
        <span className={s.sessionTime}>{istTime(session.startsAt)} – {istTime(session.endsAt)}</span>
        <div className={s.chips}>
          <Badge tone={TONE[session.status] ?? "neutral"}>{t(`card.status.${session.status}` as MessageKey)}</Badge>
          <Badge tone="neutral">{t(session.kind === "one_on_one" ? "card.oneOnOne" : "card.group")}</Badge>
        </div>
      </div>
      <h3 className={s.sessionName}>{session.batchName}</h3>
      <p className={s.meta}>
        {[
          venue,
          session.kind === "group_class"
            ? session.capacity !== null
              ? t("card.booked", { booked: session.bookedCount, capacity: session.capacity })
              : t("card.bookedNoCap", { booked: session.bookedCount })
            : null,
          session.waitlistCount > 0 ? t("card.waitlist", { n: session.waitlistCount }) : null,
          sum ? t("card.attendance", { present: sum.present, absent: sum.absent, excused: sum.excused }) : null,
        ].filter(Boolean).join(" · ")}
      </p>
      {session.status !== "cancelled" && (
        <div className={s.rowActions}>
          <ButtonLink variant={open ? "primary" : "secondary"} href={`/${role}/sessions/${session.id}`}>
            {open ? t("card.takeRoll") : t("card.open")}
          </ButtonLink>
        </div>
      )}
    </Card>
  );
}
