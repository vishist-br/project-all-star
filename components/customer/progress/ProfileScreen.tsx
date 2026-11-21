import { getMember } from "@/lib/api/members";
import { ChildSwitcher } from "@/components/customer/ChildSwitcher";
import { NoMember } from "@/components/customer/NoMember";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Avatar, Badge, Card, PageHeader } from "@/components/ui";
import { formatDay } from "@/lib/customer/format";
import { feeBadge } from "@/lib/customer/progress";
import { allow, getCustomerContext } from "@/lib/customer/server";
import { getT } from "@/lib/i18n/server";
import { getSession } from "@/lib/session";
import s from "./Progress.module.css";

/**
 * Customer Profile: the chosen member's own details, display only. Fee status is a plain badge;
 * nothing here processes payments. No photos are shown, only initials.
 */
export async function ProfileScreen() {
  const { t, locale } = await getT();
  const ctx = await getCustomerContext();
  if (!ctx.selected) return <NoMember />;
  const { principal, db, selected } = ctx;
  allow(principal, "getMember");
  const [member, session] = await Promise.all([getMember(db, principal, selected.id), getSession()]);
  const fee = feeBadge(member.feeStatus);

  return (
    <div className={s.stack}>
      <PageHeader title={t("pf.title")} subtitle={t("pf.subtitle")} />
      <ChildSwitcher members={ctx.children} selectedId={selected.id} />
      <Card>
        <dl className={s.profile}>
          <div>
            <dt>{t("pf.name")}</dt>
            <dd data-testid="profile-name"><Avatar name={member.name} /> {member.name}</dd>
          </div>
          <div>
            <dt>{t("pf.level")}</dt>
            <dd>{member.level ?? t("pf.level.none")}</dd>
          </div>
          <div>
            <dt>{t("pf.joined")}</dt>
            <dd>{formatDay(member.joinDate, locale)}</dd>
          </div>
          <div>
            <dt>{t("pf.fee")}</dt>
            <dd data-testid="fee-status">
              <Badge tone={fee.tone}>{t(`pf.fee.${fee.key}`)}</Badge>
            </dd>
          </div>
          {member.guardianName && (
            <div>
              <dt>{t("pf.guardian")}</dt>
              <dd data-testid="guardian-name">{member.guardianName}</dd>
            </div>
          )}
        </dl>
        <p className={s.meta}>{t("pf.fee.note")}</p>
      </Card>
      <Card title={t("pf.language")}>
        <LanguageSwitcher />
      </Card>
      <Card>
        <div className={s.signout}>
          {session.source === "real" ? (
            <form method="post" action="/auth/sign-out">
              <button type="submit" className="btn btn-secondary">{t("pf.signout")}</button>
            </form>
          ) : (
            <p className="muted">{t("pf.demo")}</p>
          )}
        </div>
      </Card>
    </div>
  );
}
