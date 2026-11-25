import { getPlanResults } from "../api/bulk-send";
import { getWorkoutPlan } from "../api/workout-plans";
import type { Principal } from "../auth/principal";
import type { MessageKey, Params } from "../i18n";
import type { TenantClient } from "../tenant-scope";
import { buildAssignmentView, sortByName, type AssignmentView, type ResultAssignment } from "./results";

type T = (key: MessageKey, params?: Params) => string;

/** Results of one plan as render-ready views, members in name order. Throws ApiError like the API does. */
export async function loadPlanResultViews(
  db: TenantClient,
  principal: Principal,
  planId: string,
  opts: { days: number; memberId?: string | null; t: T },
): Promise<{ planTitle: string; views: AssignmentView[] }> {
  const params = new URLSearchParams({ from: relativeDay(-(opts.days - 1)), to: relativeDay(0) });
  if (opts.memberId) params.set("memberId", opts.memberId);
  const [plan, results] = await Promise.all([getWorkoutPlan(db, principal, planId), getPlanResults(db, principal, planId, params)]);
  const views = sortByName(results.items as unknown as ResultAssignment[]).map((a) => buildAssignmentView(a, plan, opts.t));
  return { planTitle: plan.title, views };
}

/** IST calendar day offset from today as YYYY-MM-DD (the API reads dates in the business timezone). */
function relativeDay(offset: number): string {
  return new Date(Date.now() + 330 * 60_000 + offset * 86_400_000).toISOString().slice(0, 10);
}
