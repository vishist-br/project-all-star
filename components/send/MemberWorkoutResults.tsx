import { listPlanAssignments } from "@/lib/api/assignments";
import type { Principal } from "@/lib/auth/principal";
import { ApiError } from "@/lib/auth/errors";
import { getT } from "@/lib/i18n/server";
import { loadPlanResultViews } from "@/lib/send/server";
import type { TenantClient } from "@/lib/tenant-scope";
import { Card } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/States";
import { AssignmentResults } from "./AssignmentResults";
import { firstName } from "@/lib/send/view";

const MAX_PLANS = 3;

/**
 * "Workout results" on the member page: the member's recent plans with what they logged (last 28 days).
 * Plans of another coach are skipped quietly, as the API does not share them.
 */
export async function MemberWorkoutResults({ db, principal, role, memberId, memberName }: { db: TenantClient; principal: Principal; role: string; memberId: string; memberName: string }) {
  const { t } = await getT();
  let planIds: string[] = [];
  try {
    const res = await listPlanAssignments(db, principal, new URLSearchParams({ memberId, limit: "20" }));
    planIds = [...new Set(res.items.map((a) => a.planId))].slice(0, MAX_PLANS);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    return (
      <Card title={t("rs.member.title")}>
        <ErrorState title={t("ui.errorTitle")} message={t("rs.loadError")} />
      </Card>
    );
  }
  const loaded = await Promise.all(
    planIds.map(async (planId) => {
      try {
        const d = await loadPlanResultViews(db, principal, planId, { days: 28, memberId, t });
        return { planId, planTitle: d.planTitle, view: d.views[0] ?? null };
      } catch (err) {
        if (err instanceof ApiError) return null;
        throw err;
      }
    }),
  );
  const rows = loaded.filter((x): x is NonNullable<typeof x> => x !== null && x.view !== null);
  return (
    <section aria-labelledby="mwr-h" style={{ display: "grid", gap: "var(--s3)" }}>
      <h2 id="mwr-h" style={{ margin: 0, fontSize: "var(--fs-md)" }}>{t("rs.member.title")}</h2>
      {rows.length === 0 ? (
        <Card>
          <p className="muted">{t("rs.member.empty", { name: firstName(memberName) })}</p>
        </Card>
      ) : (
        rows.map((r) => (
          <div key={r.planId} style={{ display: "grid", gap: "var(--s2)" }}>
            <p className="muted small" style={{ margin: 0 }}>{t("rs.member.plan", { plan: r.planTitle })}</p>
            <AssignmentResults view={r.view!} role={role} planId={r.planId} compact />
          </div>
        ))
      )}
    </section>
  );
}
