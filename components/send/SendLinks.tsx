import { ButtonLink } from "@/components/ui/Button";
import { getT } from "@/lib/i18n/server";

/** "Send to members" for the plan detail header. One link, nothing else, so it stays out of the plan builder. */
export async function SendToMembersButton({ role, planId }: { role: string; planId: string }) {
  const { t } = await getT();
  return <ButtonLink href={`/${role}/plans/${planId}/send`}>{t("snd.sendToMembers")}</ButtonLink>;
}

/** Send and results links for one plan on the plans list. */
export async function PlanSendLinks({ role, plan }: { role: string; plan: { id: string; title: string; status: string } }) {
  const { t } = await getT();
  const label = t("snd.plans.linksLabel", { plan: plan.title });
  return (
    <div role="group" aria-label={label} style={{ display: "flex", flexWrap: "wrap", gap: "var(--s2)" }}>
      {plan.status === "active" && (
        <ButtonLink variant="secondary" href={`/${role}/plans/${plan.id}/send`} aria-label={`${t("snd.plans.send")}: ${plan.title}`}>{t("snd.plans.send")}</ButtonLink>
      )}
      {plan.status !== "draft" && (
        <ButtonLink variant="secondary" href={`/${role}/plans/${plan.id}/results`} aria-label={`${t("snd.plans.results")}: ${plan.title}`}>{t("snd.plans.results")}</ButtonLink>
      )}
    </div>
  );
}
