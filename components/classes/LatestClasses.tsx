import { ButtonLink } from "@/components/ui/Button";
import { ApiError } from "@/lib/auth/errors";
import { loadBelt, loadMemberSummaries } from "@/lib/classes/server";
import type { getCustomerContext } from "@/lib/customer/server";
import { getT } from "@/lib/i18n/server";
import { ClassSummaryCard } from "./ClassSummaryCard";
import s from "./classes.module.css";

type Ctx = Awaited<ReturnType<typeof getCustomerContext>>;

/**
 * The newest class summaries of the chosen member as cards, for Home and Updates. Only summaries from the last
 * `maxAgeDays` days, so a quiet month shows nothing and the list lives on /customer/classes. A parent sees
 * the selected child's summary.
 */
export async function LatestClasses({ ctx, limit = 1, maxAgeDays = 7, heading }: { ctx: Ctx; limit?: number; maxAgeDays?: number; heading: string }) {
  const { t } = await getT();
  if (!ctx.selected) return null;
  const { principal, db, selected, now } = ctx;
  let items: Awaited<ReturnType<typeof loadMemberSummaries>>["items"] = [];
  try {
    items = (await loadMemberSummaries(db, principal, selected.id, limit)).items;
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    return null;
  }
  const cutoff = now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000;
  items = items.filter((x) => new Date(x.publishedAt).getTime() >= cutoff);
  if (items.length === 0) return null;
  const belt = await loadBelt(db, principal, selected.id);
  return (
    <section aria-label={heading} className={s.stack}>
      <ul className={s.list}>
        {items.map((x, i) => (
          <li key={x.id}>
            <ClassSummaryCard summary={x} belt={i === 0 ? belt : null} now={now} href={`/customer/classes/${x.sessionId}`} headingLevel={2} />
          </li>
        ))}
      </ul>
      <div className={s.actions}>
        <ButtonLink variant="ghost" href="/customer/classes">{t("csm.home.all")}</ButtonLink>
      </div>
    </section>
  );
}
