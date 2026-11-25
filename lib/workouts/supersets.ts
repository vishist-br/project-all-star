/**
 * Supersets: validation and block expansion. Pure, no database.
 *
 * An item with a `supersetGroup` label ("A", "B") is done back to back with the other items of
 * the same label for `rounds` rounds. Rules: a group needs 2+ items, the items are contiguous in
 * position order (nothing else in between) and all share the same `rounds`.
 */
export type SupersetItem = { position: number; supersetGroup?: string | null; rounds?: number | null };

export type SupersetProblem = { index: number; field: "supersetGroup" | "rounds"; message: string };

export const SUPERSET_LABEL = /^[A-Za-z0-9]{1,4}$/;

/** Validates one day's items (any order; they are checked in position order). `index` is the input index. */
export function validateSupersets(items: SupersetItem[]): SupersetProblem[] {
  const problems: SupersetProblem[] = [];
  const order = items.map((it, index) => ({ it, index })).sort((a, b) => a.it.position - b.it.position || a.index - b.index);
  const groups = new Map<string, { index: number; at: number; rounds: number | null }[]>();
  order.forEach(({ it, index }, at) => {
    const label = it.supersetGroup ?? null;
    if (label === null) {
      if (it.rounds != null) problems.push({ index, field: "rounds", message: "rounds needs a supersetGroup" });
      return;
    }
    if (!SUPERSET_LABEL.test(label)) {
      problems.push({ index, field: "supersetGroup", message: "1 to 4 letters or digits, for example A" });
      return;
    }
    groups.set(label, [...(groups.get(label) ?? []), { index, at, rounds: it.rounds ?? null }]);
  });
  for (const [label, members] of groups) {
    if (members.length < 2) {
      problems.push({ index: members[0].index, field: "supersetGroup", message: `Group ${label} needs at least 2 items` });
      continue;
    }
    const contiguous = members.every((m, i) => i === 0 || m.at === members[i - 1].at + 1);
    if (!contiguous) {
      for (const m of members) problems.push({ index: m.index, field: "supersetGroup", message: `Group ${label} items must be next to each other` });
    }
    if (new Set(members.map((m) => m.rounds)).size > 1) {
      for (const m of members) problems.push({ index: m.index, field: "rounds", message: `Group ${label} items must share the same rounds` });
    }
  }
  return problems;
}

export type Block<I> = {
  type: "single" | "superset";
  /** Superset label, null for a single item. */
  label: string | null;
  /** Rounds of a superset (null when not set, and always null for a single item). */
  rounds: number | null;
  items: I[];
};

/**
 * Items (already in display order) grouped into blocks the UI renders as-is. Adjacent items with
 * the same label (and the same `scope`, for example an assignment id when several plans share a
 * day) form one superset block; everything else is a single block.
 */
export function groupIntoBlocks<I extends { supersetGroup?: string | null; rounds?: number | null }>(
  items: I[],
  scope: (item: I) => string = () => "",
): Block<I>[] {
  const blocks: Block<I>[] = [];
  let open: { key: string; block: Block<I> } | null = null;
  for (const item of items) {
    const label = item.supersetGroup ?? null;
    if (label === null) {
      blocks.push({ type: "single", label: null, rounds: null, items: [item] });
      open = null;
      continue;
    }
    const key = `${scope(item)}|${label}`;
    if (open && open.key === key) {
      open.block.items.push(item);
    } else {
      const block: Block<I> = { type: "superset", label, rounds: item.rounds ?? null, items: [item] };
      blocks.push(block);
      open = { key, block };
    }
  }
  // A lone labelled item (data from before validation, or a filtered day) renders as a single.
  return blocks.map((b) => (b.type === "superset" && b.items.length < 2 ? { ...b, type: "single" as const, label: null, rounds: null } : b));
}

/** Expands a plan day (items in position order) into render-ready blocks. */
export function expandPlanDay<I extends { position: number; supersetGroup?: string | null; rounds?: number | null }>(items: I[]): Block<I>[] {
  return groupIntoBlocks([...items].sort((a, b) => a.position - b.position));
}
