/**
 * Superset editing for the plan builder. Pure: every function takes one day's items (in order) and
 * returns new items. The invariant they all keep (and the API checks): the exercises of a superset
 * are next to each other, share one label and one number of rounds, and there are at least two.
 */
import type { ItemForm } from "./form";

export type FormBlock = {
  type: "single" | "superset";
  label: string | null;
  /** Items of the block, in order. */
  items: ItemForm[];
};

export const MAX_LABELS = 26;
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** The day's items as blocks: neighbours with the same label form a superset, everything else stands alone. */
export function formBlocks(items: readonly ItemForm[]): FormBlock[] {
  const blocks: FormBlock[] = [];
  for (const it of items) {
    const last = blocks[blocks.length - 1];
    if (it.supersetGroup !== "" && last && last.type === "superset" && last.label === it.supersetGroup) last.items.push(it);
    else if (it.supersetGroup !== "") blocks.push({ type: "superset", label: it.supersetGroup, items: [it] });
    else blocks.push({ type: "single", label: null, items: [it] });
  }
  return blocks;
}

const flatten = (blocks: readonly FormBlock[]) => blocks.flatMap((b) => b.items);

/** First letter A..Z that no exercise of the day uses; falls back to "G1", "G2"... after 26. */
export function nextLabel(items: readonly ItemForm[]): string {
  const used = new Set(items.map((i) => i.supersetGroup).filter(Boolean));
  for (const l of LETTERS) if (!used.has(l)) return l;
  for (let n = 1; n < 100; n++) if (!used.has(`G${n}`)) return `G${n}`;
  return "Z9";
}

const clear = (it: ItemForm): ItemForm => ({ ...it, supersetGroup: "", rounds: "" });

/** A superset left with one exercise is no superset: it becomes a single exercise again. Order is kept. */
export function normalizeGroups(items: readonly ItemForm[]): ItemForm[] {
  const blocks = formBlocks(items).map((b) => (b.type === "superset" && b.items.length < 2 ? { ...b, type: "single" as const, label: null, items: b.items.map(clear) } : b));
  return flatten(blocks);
}

const clampRounds = (n: number) => Math.min(20, Math.max(1, Math.round(n)));

export type GroupResult = { items: ItemForm[]; label: string; count: number };

/**
 * Groups the selected exercises as one superset. They come together at the place of the first selected
 * one (so the groups stay contiguous), get the next free label, the same rounds (default 3, or the
 * most sets any of them had) and the same rest. Returns null when fewer than two are selected.
 */
export function groupSelected(items: readonly ItemForm[], selected: ReadonlySet<string>, opts: { rounds?: number } = {}): GroupResult | null {
  const picked = items.filter((i) => selected.has(i.key));
  if (picked.length < 2) return null;
  // A label the picked exercises used before is free again once they leave their old group.
  const rest = items.filter((i) => !selected.has(i.key));
  const label = nextLabel(rest);
  const fromSets = Math.max(0, ...picked.map((p) => (/^\d+$/.test(p.sets.trim()) ? Number(p.sets) : 0)));
  const rounds = String(clampRounds(opts.rounds ?? (fromSets > 0 ? fromSets : 3)));
  const sharedRest = [...picked].reverse().find((p) => p.restSeconds.trim() !== "")?.restSeconds ?? "";
  const group = picked.map((p) => ({ ...p, supersetGroup: label, rounds, sets: rounds, restSeconds: sharedRest }));
  const at = items.findIndex((i) => selected.has(i.key));
  // Insert where the first picked item was, counted among the items that stay.
  let insertAt = items.slice(0, at).filter((i) => !selected.has(i.key)).length;
  // Never land inside another superset: step past it, so that one stays in one piece.
  while (insertAt > 0 && insertAt < rest.length && rest[insertAt - 1]!.supersetGroup !== "" && rest[insertAt - 1]!.supersetGroup === rest[insertAt]!.supersetGroup) insertAt++;
  const next = [...rest.slice(0, insertAt), ...group, ...rest.slice(insertAt)];
  return { items: normalizeGroups(next), label, count: group.length };
}

/** Takes a superset apart: its exercises stay where they are as single exercises. */
export function ungroup(items: readonly ItemForm[], label: string): ItemForm[] {
  return items.map((i) => (i.supersetGroup === label ? clear(i) : i));
}

/** Rounds of a whole superset (also the `sets` of each exercise, which a member never sees for a superset). */
export function setGroupRounds(items: readonly ItemForm[], label: string, rounds: string): ItemForm[] {
  return items.map((i) => (i.supersetGroup === label ? { ...i, rounds, sets: rounds } : i));
}

/** The rest after each round, shared by the whole superset. */
export function setGroupRest(items: readonly ItemForm[], label: string, rest: string): ItemForm[] {
  return items.map((i) => (i.supersetGroup === label ? { ...i, restSeconds: rest } : i));
}

/** Moves a whole block (a single exercise or a whole superset) one place; groups never get split. */
export function moveBlock(items: readonly ItemForm[], firstKey: string, direction: -1 | 1): ItemForm[] {
  const blocks = formBlocks(items);
  const at = blocks.findIndex((b) => b.items[0]!.key === firstKey);
  const to = at + direction;
  if (at < 0 || to < 0 || to >= blocks.length) return [...items];
  const copy = blocks.slice();
  [copy[at], copy[to]] = [copy[to]!, copy[at]!];
  return flatten(copy);
}

/** Moves one exercise inside its superset (never out of it). Exercises that stand alone move as blocks. */
export function moveItemSmart(items: readonly ItemForm[], key: string, direction: -1 | 1): ItemForm[] {
  const blocks = formBlocks(items);
  const bi = blocks.findIndex((b) => b.items.some((i) => i.key === key));
  if (bi < 0) return [...items];
  const block = blocks[bi]!;
  if (block.type === "single") return moveBlock(items, key, direction);
  const at = block.items.findIndex((i) => i.key === key);
  const to = at + direction;
  if (to < 0 || to >= block.items.length) return [...items];
  const inner = block.items.slice();
  [inner[at], inner[to]] = [inner[to]!, inner[at]!];
  return flatten(blocks.map((b, i) => (i === bi ? { ...b, items: inner } : b)));
}

/** Whether an exercise can move in a direction (for disabling the arrow buttons). */
export function canMove(items: readonly ItemForm[], key: string, direction: -1 | 1): boolean {
  const moved = moveItemSmart(items, key, direction);
  return moved.some((m, i) => m.key !== items[i]?.key);
}

export function canMoveBlock(items: readonly ItemForm[], firstKey: string, direction: -1 | 1): boolean {
  const moved = moveBlock(items, firstKey, direction);
  return moved.some((m, i) => m.key !== items[i]?.key);
}

/**
 * Takes one exercise out of its superset. It is placed right after the superset (so the rest stays
 * contiguous); a superset left with one exercise falls apart.
 */
export function leaveGroup(items: readonly ItemForm[], key: string): ItemForm[] {
  const it = items.find((i) => i.key === key);
  if (!it || it.supersetGroup === "") return [...items];
  const label = it.supersetGroup;
  const without = items.filter((i) => i.key !== key);
  let lastInGroup = -1;
  without.forEach((i, idx) => {
    if (i.supersetGroup === label) lastInGroup = idx;
  });
  const out = [...without.slice(0, lastInGroup + 1), clear(it), ...without.slice(lastInGroup + 1)];
  return normalizeGroups(out);
}

/** Removes an exercise; a superset left with one exercise falls apart. */
export function removeItem(items: readonly ItemForm[], key: string): ItemForm[] {
  return normalizeGroups(items.filter((i) => i.key !== key));
}

/** Rounds and shared rest of a superset as the coach sees them (read from its first exercise). */
export function groupSummary(block: FormBlock): { rounds: string; rest: string } {
  const first = block.items[0]!;
  return { rounds: first.rounds, rest: first.restSeconds };
}
