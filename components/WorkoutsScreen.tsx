import type { Prisma } from "@prisma/client";
import { getT } from "@/lib/i18n/server";
import { getViewer } from "@/lib/viewer";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/States";

const PAGE_SIZE = 30;

export type WorkoutFilters = { q?: string; muscle?: string; equipment?: string; level?: string; sport?: string; page?: string };

function href(f: WorkoutFilters, page: number) {
  const p = new URLSearchParams();
  for (const k of ["q", "muscle", "equipment", "level", "sport"] as const) if (f[k]) p.set(k, f[k]!);
  if (page > 1) p.set("page", String(page));
  const qs = p.toString();
  return qs ? `?${qs}` : "?";
}

function Select({ name, label, value, options, all }: { name: string; label: string; value?: string; options: string[]; all: string }) {
  return (
    <label className="filter">
      <span className="small muted">{label}</span>
      <select name={name} defaultValue={value ?? ""}>
        <option value="">{all}</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}

/** Read-only exercise library for the signed-in business (same catalog for every role). */
export async function WorkoutsScreen({ filters }: { filters: WorkoutFilters }) {
  const { t } = await getT();
  const { db } = await getViewer();

  const where: Prisma.ExerciseWhereInput = {};
  if (filters.q) where.name = { contains: filters.q, mode: "insensitive" };
  if (filters.muscle) where.primaryMuscles = { has: filters.muscle };
  if (filters.equipment) where.equipment = filters.equipment;
  if (filters.level) where.level = filters.level;
  if (filters.sport) where.sportSlug = filters.sport;

  const page = Math.max(1, Number.parseInt(filters.page ?? "1", 10) || 1);
  const [total, rows, facets] = await Promise.all([
    db.exercise.count({ where }),
    db.exercise.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    db.exercise.findMany({ select: { sportSlug: true, equipment: true, level: true, primaryMuscles: true } }),
  ]);
  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort();
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <form method="get" className="filters">
        <label className="filter">
          <span className="small muted">{t("wk.search")}</span>
          <input type="search" name="q" defaultValue={filters.q ?? ""} />
        </label>
        <Select name="sport" label={t("wk.sport")} value={filters.sport} options={uniq(facets.map((f) => f.sportSlug))} all={t("wk.all")} />
        <Select name="muscle" label={t("wk.muscle")} value={filters.muscle} options={uniq(facets.flatMap((f) => f.primaryMuscles))} all={t("wk.all")} />
        <Select name="equipment" label={t("wk.equipment")} value={filters.equipment} options={uniq(facets.map((f) => f.equipment))} all={t("wk.all")} />
        <Select name="level" label={t("wk.level")} value={filters.level} options={uniq(facets.map((f) => f.level))} all={t("wk.all")} />
        <Button type="submit">{t("wk.filter")}</Button>
      </form>
      <p className="muted">{t("wk.results", { n: total })}</p>
      <ul className="card-list">
        {rows.map((e) => (
          <li key={e.id} className="card">
            <details>
              <summary>
                <strong>{e.name}</strong>
                <span className="small muted">&nbsp;· {[e.sportSlug, e.equipment, e.level].filter(Boolean).join(" · ")}</span>
              </summary>
              {e.needsTrainerReview && <p><Badge tone="warn">{t("wk.draft")}</Badge></p>}
              {e.primaryMuscles.length > 0 && <p className="small">{t("wk.primary")}: {e.primaryMuscles.join(", ")}</p>}
              {e.secondaryMuscles.length > 0 && <p className="small">{t("wk.secondary")}: {e.secondaryMuscles.join(", ")}</p>}
              {e.instructions.length > 0 && (
                <>
                  <p className="small"><strong>{t("wk.instructions")}</strong></p>
                  <ol className="small">{e.instructions.map((s, i) => <li key={i}>{s}</li>)}</ol>
                </>
              )}
              <p className="small muted">{t("wk.licence", { licence: e.licence })}</p>
            </details>
          </li>
        ))}
      </ul>
      {rows.length === 0 && <EmptyState title={t("data.empty")} />}
      <nav className="pager" aria-label={t("wk.page", { n: page, total: totalPages })}>
        {page > 1 && <ButtonLink variant="secondary" href={href(filters, page - 1)}>{t("wk.prev")}</ButtonLink>}
        <span className="muted small">{t("wk.page", { n: page, total: totalPages })}</span>
        {page < totalPages && <ButtonLink variant="secondary" href={href(filters, page + 1)}>{t("wk.next")}</ButtonLink>}
      </nav>
    </>
  );
}
