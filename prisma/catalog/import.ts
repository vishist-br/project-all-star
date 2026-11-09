import { readFileSync, existsSync } from "node:fs";
import type { Prisma, PrismaClient } from "@prisma/client";

// Exercise catalog import. One script loads both sources into a tenant's `exercises` table:
//  - gym: data/free-exercise-db/exercises.json (Unlicense, pinned commit, images dropped)
//  - non-gym: data/exercises/original-sports.json (our own text, needs trainer review)
// Re-runnable: rows are keyed by (tenantId, source, sourceId) and upserted. A re-import
// refreshes content but never touches needsTrainerReview / reviewedAt.

export type CatalogEntry = {
  source: "FREE_EXERCISE_DB" | "ORIGINAL";
  sourceId: string;
  sportSlug: string;
  name: string;
  category: string | null;
  level: string | null;
  equipment: string | null;
  force: string | null;
  mechanic: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  instructions: string[];
  licence: string;
  sourceCommit: string | null;
  needsTrainerReview: boolean;
};

type FedFile = { license: string; commit: string; exercises: Record<string, unknown>[] };
type OriginalFile = { exercises: Record<string, unknown>[] };

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function loadGymEntries(path = "data/free-exercise-db/exercises.json"): CatalogEntry[] {
  const file = JSON.parse(readFileSync(path, "utf8")) as FedFile;
  return file.exercises.map((e) => ({
    source: "FREE_EXERCISE_DB" as const,
    sourceId: String(e.id),
    sportSlug: "gym",
    name: String(e.name),
    category: str(e.category),
    level: str(e.level),
    equipment: str(e.equipment),
    force: str(e.force),
    mechanic: str(e.mechanic),
    primaryMuscles: strs(e.primaryMuscles),
    secondaryMuscles: strs(e.secondaryMuscles),
    instructions: strs(e.instructions),
    licence: file.license,
    sourceCommit: file.commit,
    // A public dataset, not a draft of ours; a trainer can still flag entries later.
    needsTrainerReview: false,
  }));
}

export function loadOriginalEntries(path = "data/exercises/original-sports.json"): CatalogEntry[] {
  if (!existsSync(path)) return [];
  const file = JSON.parse(readFileSync(path, "utf8")) as OriginalFile;
  return file.exercises.map((e) => ({
    source: "ORIGINAL" as const,
    sourceId: String(e.id),
    sportSlug: String(e.sport),
    name: String(e.name),
    category: str(e.category),
    level: str(e.level),
    equipment: str(e.equipment),
    force: str(e.force),
    mechanic: str(e.mechanic),
    primaryMuscles: strs(e.primaryMuscles),
    secondaryMuscles: strs(e.secondaryMuscles),
    instructions: strs(e.instructions),
    licence: "Original (project)",
    sourceCommit: null,
    needsTrainerReview: true,
  }));
}

export function loadAllEntries(): CatalogEntry[] {
  return [...loadGymEntries(), ...loadOriginalEntries()];
}

export async function importCatalog(
  prisma: PrismaClient,
  tenantId: string,
  entries: CatalogEntry[] = loadAllEntries(),
): Promise<{ total: number }> {
  const CHUNK = 100;
  for (let i = 0; i < entries.length; i += CHUNK) {
    const ops: Prisma.PrismaPromise<unknown>[] = entries.slice(i, i + CHUNK).map((e) => {
      const { needsTrainerReview, ...content } = e;
      return prisma.exercise.upsert({
        where: { tenantId_source_sourceId: { tenantId, source: e.source, sourceId: e.sourceId } },
        update: content,
        create: { tenantId, needsTrainerReview, ...content },
      });
    });
    await prisma.$transaction(ops);
  }
  return { total: entries.length };
}
