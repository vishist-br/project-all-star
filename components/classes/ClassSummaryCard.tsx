import Link from "next/link";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { formatDay } from "@/lib/customer/format";
import { relativeWhen, whenText, type BeltLike } from "@/lib/classes/view";
import type { MemberSummary } from "@/lib/classes/server";
import type { MessageKey } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { ShareWithFamily } from "./ShareWithFamily";
import { SummaryBody } from "./SummaryBody";
import s from "./classes.module.css";

const TONE: Record<string, Tone> = { present: "ok", absent: "info", excused: "neutral" };

/**
 * A member's class summary as a card: "Class summary, just now", the words, and Share with family.
 * `href` makes the title block a link to the class page (used in lists and on Home).
 */
export async function ClassSummaryCard({ summary, belt, now = new Date(), href, share = true, headingLevel = 2 }: { summary: MemberSummary; belt?: BeltLike | null; now?: Date; href?: string; share?: boolean; headingLevel?: 2 | 3 }) {
  const { t, locale } = await getT();
  const f = summary.forMember;
  const when = whenText(relativeWhen(summary.publishedAt, now), t, (iso) => formatDay(iso.slice(0, 10), locale));
  return (
    <Card as="article" className={s.card}>
      <div className={s.tagRow}>
        <div className={s.tags}>
          <Badge tone="info">{t("csm.tag", { when })}</Badge>
          <Badge tone={TONE[f.status] ?? "neutral"}>{t(`csm.status.${f.status}` as MessageKey)}</Badge>
        </div>
      </div>
      <SummaryBody
        data={{ titleKey: f.titleKey, bodyKey: f.bodyKey, params: f.params, status: f.status, coachNote: summary.coachNote, homePractice: summary.homePractice, workout: summary.workout }}
        belt={belt}
        headingLevel={headingLevel}
      />
      <div className={s.actions}>
        {share && f.status === "present" && <ShareWithFamily sessionId={summary.sessionId} memberId={f.memberId} />}
        {href && <Link className="btn btn-ghost" href={href}>{t("csm.open")}</Link>}
      </div>
    </Card>
  );
}
