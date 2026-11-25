/**
 * View-model for belts and skills: which checklist is "next belt" per sport, what is left to sign off
 * and the rating chips. Pure functions over the `getMemberSkillProgress` response.
 */

export type SkillItem = {
  skillItemId: string;
  title: string;
  description?: string | null;
  signedOff: boolean;
  rating: number | null;
  note?: string | null;
  signedOffAt: string | null;
  signedOffByName: string | null;
};
export type Checklist = {
  checklistId: string;
  sportId: string;
  sportName: string;
  levelId: string | null;
  levelName: string | null;
  levelRank: number | null;
  levelColorHex: string | null;
  title: string;
  isNextLevel: boolean;
  doneCount: number;
  totalCount: number;
  percent: number;
  complete: boolean;
  items: SkillItem[];
};
export type SkillProgress = {
  memberId: string;
  currentLevels: { sportId: string; levelName: string; rank: number }[];
  checklists: Checklist[];
};

export const RATING_KEYS = { 1: "sk.rating.1", 2: "sk.rating.2", 3: "sk.rating.3", 4: "sk.rating.4" } as const;
export const RATINGS = [1, 2, 3, 4] as const;

export function ratingKey(r: number): (typeof RATING_KEYS)[1 | 2 | 3 | 4] {
  return RATING_KEYS[Math.min(4, Math.max(1, Math.round(r))) as 1 | 2 | 3 | 4];
}

export type BeltCardModel = {
  checklist: Checklist;
  levelName: string;
  done: number;
  total: number;
  percent: number;
  complete: boolean;
  /** Titles still to sign off (first `maxLeft`), and how many more there are. */
  left: string[];
  moreLeft: number;
  rated: { title: string; rating: number }[];
};

/** One card per sport whose next belt has a checklist. Empty when the academy has no checklists. */
export function beltCards(p: SkillProgress, maxLeft = 3): BeltCardModel[] {
  return p.checklists
    .filter((c) => c.isNextLevel && c.totalCount > 0)
    .map((c) => {
      const left = c.items.filter((i) => !i.signedOff).map((i) => i.title);
      return {
        checklist: c,
        levelName: c.levelName ?? c.title,
        done: c.doneCount,
        total: c.totalCount,
        percent: c.percent,
        complete: c.complete,
        left: left.slice(0, maxLeft),
        moreLeft: Math.max(0, left.length - maxLeft),
        rated: c.items.filter((i) => i.signedOff && i.rating !== null).map((i) => ({ title: i.title, rating: i.rating! })),
      };
    });
}

/** Checklists ordered for the full page: next belt first, then the rest by sport and rank. */
export function orderChecklists(p: SkillProgress): Checklist[] {
  return [...p.checklists].sort(
    (a, b) => Number(b.isNextLevel) - Number(a.isNextLevel) || a.sportName.localeCompare(b.sportName) || (a.levelRank ?? 0) - (b.levelRank ?? 0),
  );
}

export function currentLevelName(p: SkillProgress, sportId: string): string | null {
  return p.currentLevels.find((l) => l.sportId === sportId)?.levelName ?? null;
}

/** Readable text colour for a belt swatch label. Used only for the swatch outline decision, never as the only signal. */
export function swatchColor(hex: string | null): string {
  return hex && /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : "var(--line-strong)";
}
