import { describe, expect, it } from "vitest";
import { barPercent, clock, parseInsightRange, pct, suggestionText, typicalAttendance, weekdays, type Slot } from "../lib/insights/view";
import { translate } from "../lib/i18n";
import { beltCards, currentLevelName, orderChecklists, ratingKey, swatchColor, type Checklist, type SkillProgress } from "../lib/skills/view";

const item = (title: string, rating: number | null = null) => ({ skillItemId: title, title, signedOff: rating !== null, rating, signedOffAt: rating ? "2026-11-01T00:00:00Z" : null, signedOffByName: rating ? "Coach" : null });
const list = (o: Partial<Checklist> & { items: Checklist["items"] }): Checklist => ({
  checklistId: o.levelName ?? "x",
  sportId: "s1",
  sportName: "Karate",
  levelId: "l",
  levelName: "Yellow",
  levelRank: 1,
  levelColorHex: "#FFD400",
  title: "Yellow belt",
  isNextLevel: true,
  doneCount: o.items.filter((i) => i.signedOff).length,
  totalCount: o.items.length,
  percent: Math.round((100 * o.items.filter((i) => i.signedOff).length) / o.items.length),
  complete: o.items.every((i) => i.signedOff),
  ...o,
});

describe("belt card model", () => {
  const items = [item("Stance", 3), item("Block", 4), item("Kick"), item("Kata"), item("Bow"), item("Count")];
  const p: SkillProgress = {
    memberId: "m",
    currentLevels: [{ sportId: "s1", levelName: "White", rank: 0 }],
    checklists: [list({ items }), list({ levelName: "Orange", levelRank: 2, isNextLevel: false, items: [item("A")] })],
  };
  it("builds one card for the next belt with counts, what is left and ratings", () => {
    const [card] = beltCards(p);
    expect(beltCards(p)).toHaveLength(1);
    expect(card!.levelName).toBe("Yellow");
    expect([card!.done, card!.total, card!.percent]).toEqual([2, 6, 33]);
    expect(card!.left).toEqual(["Kick", "Kata", "Bow"]);
    expect(card!.moreLeft).toBe(1);
    expect(card!.rated.map((r) => r.rating)).toEqual([3, 4]);
  });
  it("is empty when the academy has no checklists", () => {
    expect(beltCards({ memberId: "m", currentLevels: [], checklists: [] })).toEqual([]);
  });
  it("marks a finished checklist as complete", () => {
    const [c] = beltCards({ ...p, checklists: [list({ items: [item("A", 2), item("B", 4)] })] });
    expect(c!.complete).toBe(true);
    expect(c!.left).toEqual([]);
  });
  it("orders the next belt first and names the current level", () => {
    expect(orderChecklists({ ...p, checklists: [p.checklists[1]!, p.checklists[0]!] })[0]!.levelName).toBe("Yellow");
    expect(currentLevelName(p, "s1")).toBe("White");
    expect(ratingKey(9)).toBe("sk.rating.4");
    expect(swatchColor("nope")).toBe("var(--line-strong)");
  });
});

describe("class insights view", () => {
  const slot = (o: Partial<Slot> = {}): Slot => ({ batchId: "b", batchName: "Evening", sportName: "Karate", daysOfWeek: [3, 1], startTime: "18:00", endTime: "19:00", capacity: 12, sessionCount: 8, avgFillRate: 91.7, attendanceRate: 80, workoutSentShare: 50, waitlistCount: 0, quietSlot: false, ...o });
  const t = (k: Parameters<typeof translate>[1], p?: Record<string, string | number>) => translate("en", k, p);
  it("parses the range with 28 days as default", () => {
    expect(parseInsightRange("7d")).toBe("7d");
    expect(parseInsightRange("1y")).toBe("28d");
  });
  it("turns fill into whole people out of capacity", () => {
    expect(typicalAttendance(slot())).toEqual({ n: 11, of: 12 });
    expect(typicalAttendance(slot({ capacity: null }))).toBeNull();
    expect(typicalAttendance(slot({ avgFillRate: null }))).toBeNull();
  });
  it("formats rates, bars, weekdays and times", () => {
    expect(pct(81.6, "en")).toBe("82%");
    expect(pct(null, "en")).toBeNull();
    expect(barPercent(140)).toBe(100);
    expect(barPercent(null)).toBe(0);
    expect(weekdays([3, 1], "en")).toBe("Mon, Wed");
    expect(clock("18:00", "en").toLowerCase()).toBe("6:00 pm");
  });
  it("translates known suggestions with their params and drops unknown keys", () => {
    expect(suggestionText({ kind: "add_class", messageKey: "ci.addClass", batchId: "b", params: { batchName: "Evening", waitlistCount: 4 } }, t)).toContain("Evening has 4 people waiting");
    expect(suggestionText({ kind: "x", messageKey: "ci.unknown", batchId: "b", params: {} }, t)).toBeNull();
  });
});
