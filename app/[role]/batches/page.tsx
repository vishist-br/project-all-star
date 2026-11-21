import Link from "next/link";
import { notFound } from "next/navigation";
import { NotAllowed } from "@/components/NotAllowed";
import s from "@/components/owner/batches/batches.module.css";
import { fill, filterOptions, pickFilter, summariseSchedule } from "@/components/owner/batches/view-model";
import { weekdayName } from "@/components/owner/dashboard/view-model";
import { Badge, ProgressBar } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Form";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { listBatches } from "@/lib/api/batches";
import { listCoaches } from "@/lib/api/coaches";
import { listVenues } from "@/lib/api/venues";
import { checkRole } from "@/lib/auth/guard";
import { getT } from "@/lib/i18n/server";
import { isRole } from "@/lib/nav";
import { getViewer } from "@/lib/viewer";

const LIMIT = () => new URLSearchParams({ limit: "100" });

/** Owner batches: cards with sport, venue, coach, schedule and a members-against-capacity bar. Filters live in the URL. */
export default async function BatchesPage({ params, searchParams }: { params: Promise<{ role: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { role } = await params;
  if (!isRole(role)) notFound();
  const sp = await searchParams;
  const { t, locale } = await getT();
  const { principal, db } = await getViewer();
  if (principal.role !== "owner" || role !== "owner") return <NotAllowed role={principal.role} />;
  checkRole(principal, "listBatches");

  const header = <PageHeader title={t("nav.batches")} />;
  let all: Awaited<ReturnType<typeof listBatches>>;
  try {
    all = await listBatches(db, principal, LIMIT());
  } catch (err) {
    console.error("owner batches failed", err instanceof Error ? err.message : err);
    return (
      <>
        {header}
        <div className={s.errorBox}>
          <ErrorState title={t("od.error.title")} message={t("od.error.text")} />
          <ButtonLink variant="secondary" href="/owner/batches">{t("od.error.retry")}</ButtonLink>
        </div>
      </>
    );
  }
  if (all.items.length === 0) {
    return (
      <>
        {header}
        <EmptyState title={t("ob.empty.title")} text={t("ob.empty.text")} />
      </>
    );
  }

  const [venueList, coachList] = await Promise.all([
    listVenues(db, principal, LIMIT()).catch(() => ({ items: [] as { id: string; name: string }[] })),
    listCoaches(db).catch(() => ({ items: [] as { id: string; name: string }[] })),
  ]);
  const coachName = new Map(coachList.items.map((c) => [c.id, c.name]));
  const options = filterOptions(all.items);
  // Venue names from the venues API win over the names carried on the batches.
  const venueNames = new Map(venueList.items.map((v) => [v.id, v.name]));
  const venues = options.venues.map((v) => ({ id: v.id, name: venueNames.get(v.id) ?? v.name }));
  const venueId = pickFilter(sp.venueId, venues);
  const sportId = pickFilter(sp.sportId, options.sports);
  const shown = all.items.filter((b) => (!venueId || b.venueId === venueId) && (!sportId || b.sportId === sportId));
  const filtered = Boolean(venueId || sportId);

  return (
    <>
      {header}
      <form method="get" className={s.filters} role="search" aria-label={t("ob.filter.label")}>
        <label className="field">
          <span className="field-label">{t("ob.venue")}</span>
          <Select name="venueId" defaultValue={venueId ?? ""}>
            <option value="">{t("ob.all.venues")}</option>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </Select>
        </label>
        <label className="field">
          <span className="field-label">{t("ob.sport")}</span>
          <Select name="sportId" defaultValue={sportId ?? ""}>
            <option value="">{t("ob.all.sports")}</option>
            {options.sports.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </Select>
        </label>
        <div className={s.filterActions}>
          <Button type="submit" variant="secondary">{t("ob.apply")}</Button>
          {filtered && <ButtonLink variant="ghost" href="/owner/batches">{t("ob.clear")}</ButtonLink>}
        </div>
      </form>

      {shown.length === 0 ? (
        <EmptyState
          title={t("ob.filtered.title")}
          text={t("ob.filtered.text")}
          action={<ButtonLink variant="secondary" href="/owner/batches">{t("ob.clear")}</ButtonLink>}
        />
      ) : (
        <>
          <p className={`${s.muted} small`} aria-live="polite">{t("ob.count", { n: shown.length })}</p>
          <ul className={s.cards} aria-label={t("nav.batches")}>
            {shown.map((b) => {
              const sched = summariseSchedule(b.schedule);
              const f = fill(b.memberCount, b.capacity);
              const coachId = b.coachIds[0];
              const name = coachName.get(coachId);
              return (
                <Card as="li" key={b.id} className={s.card}>
                  <div className={s.head}>
                    <strong className={s.title}>{b.name}</strong>
                    {b.isGroupClass && <Badge tone="info">{t("ob.group")}</Badge>}
                  </div>
                  <div className={s.where}>
                    {b.sportName} · {venueNames.get(b.venueId) ?? b.venueName}
                  </div>
                  {sched ? (
                    <div>
                      <div className={s.days}>
                        {sched.weekdays.map((d) => (
                          <Badge key={d} tone="neutral">{weekdayName(d, locale)}</Badge>
                        ))}
                      </div>
                      <div className={s.time}>{sched.time}</div>
                    </div>
                  ) : (
                    <div className={`${s.where}`}>{t("ob.noSchedule")}</div>
                  )}
                  {name && coachId && (
                    <Link href={`/owner/coaches/${coachId}`} className={s.coach}>
                      {t("ob.coach", { name })}
                    </Link>
                  )}
                  <div className={s.fill}>
                    {f.percent === null ? (
                      <span className={s.fillText}>{t("ob.noCap", { count: b.memberCount })}</span>
                    ) : (
                      <>
                        <div className={s.fillText}>
                          <span>{t("ob.cap", { count: b.memberCount, capacity: b.capacity ?? 0 })}</span>
                          <strong>{f.full ? t("ob.full") : t("ob.open", { open: f.open ?? 0 })}</strong>
                        </div>
                        <ProgressBar value={f.percent} label={t("data.members")} />
                      </>
                    )}
                  </div>
                </Card>
              );
            })}
          </ul>
        </>
      )}
      <nav className={s.links} aria-label={t("set.links.title")}>
        <ButtonLink variant="secondary" href="/owner/coaches">{t("ob.coaches")}</ButtonLink>
      </nav>
    </>
  );
}
