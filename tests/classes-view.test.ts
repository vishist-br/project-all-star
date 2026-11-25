import { describe, expect, it } from "vitest";
import { translate } from "../lib/i18n";
import { finishAudience, isShareUrl, nextBelt, relativeWhen, targetText, whenText, workoutBlocks, type WorkoutLike } from "../lib/classes/view";
import { buildInboxCards } from "../lib/send/inbox";
import {
  addIntent,
  bumpAttempt,
  intentBody,
  loadIntents,
  makeIntent,
  MAX_FINISH_ATTEMPTS,
  parseIntents,
  readyIntents,
  removeIntent,
  saveIntents,
} from "../lib/offline/finish";

const t = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) => translate("en", key, params);

describe("who gets what when the class is finished", () => {
  const row = (attendance: "present" | "absent" | "excused" | "not_marked", extra: Record<string, unknown> = {}) => ({ attendance, tappable: true, declaredReason: null, ...extra }) as never;
  it("counts present, absent and members who told us in advance", () => {
    const a = finishAudience([row("present"), row("present"), row("absent"), row("excused"), row("not_marked", { declaredReason: "exam" }), row("not_marked")]);
    expect(a).toEqual({ present: 2, absent: 1, told: 2 });
  });
  it("ignores waitlisted rows", () => {
    expect(finishAudience([row("present", { tappable: false })])).toEqual({ present: 0, absent: 0, told: 0 });
  });
});

describe("class summary timing and words", () => {
  const now = new Date("2026-11-25T10:00:00Z");
  it("says just now, today, yesterday, then a date", () => {
    expect(relativeWhen("2026-11-25T09:50:00Z", now).kind).toBe("now");
    expect(relativeWhen("2026-11-25T05:00:00Z", now).kind).toBe("today");
    expect(relativeWhen("2026-11-24T08:00:00Z", now).kind).toBe("yesterday");
    expect(relativeWhen("2026-11-20T08:00:00Z", now).kind).toBe("date");
    expect(whenText({ kind: "now" }, t, () => "x")).toBe("just now");
    expect(whenText({ kind: "date", iso: "2026-11-20" }, t, () => "20 Nov")).toBe("20 Nov");
  });
  const item = (o: Record<string, unknown> = {}) => ({ id: "i", exerciseName: "Punch", sets: null, reps: null, durationSeconds: null, targetDistanceMeters: null, ...o });
  it("writes the target of an exercise", () => {
    expect(targetText(item({ sets: 3, reps: 10 }), t)).toBe("3 sets of 10");
    expect(targetText(item({ reps: 8 }), t)).toBe("8 reps");
    expect(targetText(item({ durationSeconds: 45 }), t)).toBe("45 sec");
    expect(targetText(item({ targetDistanceMeters: 50 }), t)).toBe("50 m");
    expect(targetText(item(), t)).toBe("");
  });
  it("keeps a superset as one block with a heading", () => {
    const w: WorkoutLike = {
      planTitle: "Kids class",
      dayTitle: null,
      blocks: [
        { type: "superset", label: "A", rounds: 3, items: [item({ id: "1", exerciseName: "Punch" }), item({ id: "2", exerciseName: "Block" })] },
        { type: "single", label: null, rounds: null, items: [item({ id: "3", exerciseName: "Kata", reps: 5 })] },
      ],
    };
    const b = workoutBlocks(w, t);
    expect(b).toHaveLength(2);
    expect(b[0]).toMatchObject({ superset: true, heading: "Superset A · 3 rounds" });
    expect(b[0]!.rows.map((r) => r.name)).toEqual(["Punch", "Block"]);
    expect(b[1]).toMatchObject({ superset: false, heading: null });
    expect(workoutBlocks(null, t)).toEqual([]);
  });
  it("shows the next belt progress, or nothing when there is no checklist", () => {
    const c = (o: Record<string, unknown>) => ({ isNextLevel: false, levelName: "Yellow belt", title: "Yellow", doneCount: 3, totalCount: 6, percent: 50, ...o });
    expect(nextBelt({ checklists: [c({}), c({ isNextLevel: true })] })).toEqual({ levelName: "Yellow belt", doneCount: 3, totalCount: 6, percent: 50 });
    expect(nextBelt({ checklists: [c({})] })).toBeNull();
    expect(nextBelt(null)).toBeNull();
  });
  it("recognises a share url", () => {
    expect(isShareUrl("http://localhost:3000/share/class/" + "a".repeat(43))).toBe(true);
    expect(isShareUrl("http://localhost:3000/customer/home")).toBe(false);
  });
});

describe("finish saved on the device", () => {
  const entry = (id: string) => ({ memberId: id, status: "present" as const, reason: null, note: null, clientId: `att-${id}-12345678` });
  const intent = makeIntent({ sessionId: "s1", entries: [entry("m1"), entry("m2")], coachNote: "  Well done  ", homePractice: "" }, new Date("2026-11-25T10:00:00Z"));
  it("keeps one intent per session and trims the texts", () => {
    expect(intent.coachNote).toBe("Well done");
    expect(intent.homePractice).toBeNull();
    const list = addIntent(addIntent([], intent), { ...intent, coachNote: "Again" });
    expect(list).toHaveLength(1);
    expect(list[0]!.coachNote).toBe("Again");
    expect(removeIntent(list, "s1")).toEqual([]);
  });
  it("waits while marks of the session are still queued on the device", () => {
    expect(readyIntents([intent], [{ sessionId: "s1", state: "queued" }])).toEqual([]);
    expect(readyIntents([intent], [{ sessionId: "s2", state: "queued" }])).toHaveLength(1);
    expect(readyIntents([intent], [{ sessionId: "s1", state: "conflict" }])).toHaveLength(1);
  });
  it("stops after too many tries", () => {
    let list = [intent];
    for (let i = 0; i < MAX_FINISH_ATTEMPTS; i += 1) list = bumpAttempt(list, "s1");
    expect(readyIntents(list, [])).toEqual([]);
  });
  it("sends the same marks again with their client ids (a replay is safe)", () => {
    const body = intentBody(intent);
    expect(body.entries.map((e) => e.clientId)).toEqual(["att-m1-12345678", "att-m2-12345678"]);
    expect(body.coachNote).toBe("Well done");
  });
  it("survives storage round trips and ignores garbage", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    saveIntents("u1", [intent], storage);
    expect(loadIntents("u1", storage)).toEqual([intent]);
    saveIntents("u1", [], storage);
    expect(store.size).toBe(0);
    expect(parseIntents("not json")).toEqual([]);
    expect(parseIntents(JSON.stringify([{ sessionId: "s", entries: [{ memberId: "m", status: "bogus", clientId: "x" }], createdAt: "now" }]))).toEqual([]);
  });
});

describe("new from coach cards", () => {
  const upd = (o: Record<string, unknown> = {}) => ({ id: "u1", kind: "plan_assigned", entityType: "assignment", entityId: "a1", actorName: "Sample Coach Alpha", params: { planTitle: "Kids Daily", startsOn: "2026-11-26", note: "Start on Monday" }, createdAt: "2026-11-25T08:00:00Z", read: false, ...o });
  const asg = (o: Record<string, unknown> = {}) => ({ id: "a1", planId: "p1", planTitle: "Kids Daily", startsOn: "2026-11-26", endsOn: null, note: null, status: "active", ...o });
  const plans = new Map([["p1", { id: "p1", title: "Kids Daily", days: [{ items: [{ exerciseName: "Squat" }, { exerciseName: "Push-up" }] }] }]]);
  it("shows the coach, plan, schedule, note and exercises", () => {
    const [c] = buildInboxCards([upd()], [asg()], plans, t, "en", "2026-11-25");
    expect(c).toMatchObject({ tag: "New from Coach Alpha", planTitle: "Kids Daily", note: "Start on Monday", exerciseCountText: "2 exercises" });
    expect(c!.scheduleLine).toMatch(/^Starts /);
    expect(c!.exercises).toEqual(["Squat", "Push-up"]);
  });
  it("skips read updates, other kinds and ended plans, and never repeats a plan", () => {
    expect(buildInboxCards([upd({ read: true })], [asg()], plans, t, "en", "2026-11-25")).toEqual([]);
    expect(buildInboxCards([upd({ kind: "goal_set" })], [asg()], plans, t, "en", "2026-11-25")).toEqual([]);
    expect(buildInboxCards([upd()], [asg({ status: "ended" })], plans, t, "en", "2026-11-25")).toEqual([]);
    expect(buildInboxCards([upd(), upd({ id: "u2" })], [asg()], plans, t, "en", "2026-11-25")).toHaveLength(1);
  });
  it("copes with a missing plan and no coach name", () => {
    const [c] = buildInboxCards([upd({ actorName: null })], [], new Map(), t, "en", "2026-11-25");
    expect(c).toMatchObject({ tag: "New from your coach", planTitle: "Kids Daily", exercises: [] });
  });
  it("says 'since' once the plan has started, and the range when it has an end", () => {
    expect(buildInboxCards([upd()], [asg({ startsOn: "2026-11-20" })], plans, t, "en", "2026-11-25")[0]!.scheduleLine).toMatch(/^Since /);
    expect(buildInboxCards([upd()], [asg({ endsOn: "2026-12-20" })], plans, t, "en", "2026-11-25")[0]!.scheduleLine).toContain(" to ");
  });
  it("limits the number of cards", () => {
    const many = Array.from({ length: 5 }, (_, i) => upd({ id: `u${i}`, entityId: `a${i}` }));
    const asgs = many.map((u, i) => asg({ id: `a${i}` }));
    expect(buildInboxCards(many, asgs, plans, t, "en", "2026-11-25", 3)).toHaveLength(3);
  });
});
