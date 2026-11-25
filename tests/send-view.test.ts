import { describe, expect, it } from "vitest";
import {
  buildSendPayload,
  coachLabel,
  countResults,
  estimateDayMinutes,
  groupAllSelected,
  groupMembers,
  memberLink,
  NOTE_MAX,
  OTHER_GROUP,
  repeatEnd,
  summarizePlan,
  toggleEveryone,
  toggleGroup,
  toggleOne,
  validateSend,
  type MemberRow,
  type SendForm,
} from "../lib/send/view";

const item = (o: Partial<Parameters<typeof estimateDayMinutes>[0][number]> = {}) => ({ sets: 3, reps: 10, durationSeconds: null, restSeconds: 60, supersetGroup: null, rounds: null, ...o });

describe("plan summary for the send screen", () => {
  it("counts exercises and supersets and estimates minutes in 5 minute steps", () => {
    const day = {
      items: [
        item({ sets: 3, reps: 10 }),
        item({ supersetGroup: "A", rounds: 3, reps: 12 }),
        item({ supersetGroup: "A", rounds: 3, reps: 12 }),
        item({ sets: 4, reps: 8 }),
      ],
    };
    const s = summarizePlan([day]);
    expect(s.exercises).toBe(4);
    expect(s.supersets).toBe(1);
    expect(s.minutes % 5).toBe(0);
    expect(s.minutes).toBeGreaterThanOrEqual(5);
    expect(s.days).toBe(1);
  });
  it("uses the busiest day and ignores empty days", () => {
    const s = summarizePlan([{ items: [] }, { items: [item()] }, { items: [item(), item()] }]);
    expect(s).toMatchObject({ exercises: 2, days: 2 });
  });
  it("is empty for a plan with no exercises", () => {
    expect(summarizePlan([{ items: [] }])).toEqual({ exercises: 0, supersets: 0, minutes: 0, days: 0 });
    expect(estimateDayMinutes([])).toBe(0);
  });
  it("counts timed and distance work, not only reps", () => {
    expect(estimateDayMinutes([item({ reps: null, durationSeconds: 600, sets: 1 })])).toBeGreaterThanOrEqual(10);
    expect(estimateDayMinutes([item({ reps: null, targetDistanceMeters: 400, sets: 2 })])).toBeGreaterThan(0);
  });
});

const members: MemberRow[] = [
  { id: "m1", name: "Aarav Sharma", level: "Yellow belt", batchIds: ["b1"] },
  { id: "m2", name: "Diya Rao", level: null, batchIds: ["b1", "b2"] },
  { id: "m3", name: "Kabir Nair", level: null, batchIds: ["b2"] },
  { id: "m4", name: "Zoya Khan", level: null, batchIds: [] },
];
const batches = [{ id: "b1", name: "Kids evening" }, { id: "b2", name: "Teens" }];

describe("choosing members", () => {
  it("groups by first batch in batch order, with the rest last", () => {
    const g = groupMembers(members, batches);
    expect(g.map((x) => [x.id, x.members.map((m) => m.id)])).toEqual([["b1", ["m1", "m2"]], ["b2", ["m3"]], [OTHER_GROUP, ["m4"]]]);
  });
  it("searches by name, case-insensitively, and drops empty groups", () => {
    expect(groupMembers(members, batches, "KAB").map((g) => g.id)).toEqual(["b2"]);
    expect(groupMembers(members, batches, "nobody")).toEqual([]);
  });
  it("toggles one member, a group and everyone", () => {
    const g = groupMembers(members, batches)[0]!;
    let sel = toggleOne(new Set(), "m1");
    expect([...sel]).toEqual(["m1"]);
    expect(groupAllSelected(sel, g)).toBe(false);
    sel = toggleGroup(sel, g);
    expect(groupAllSelected(sel, g)).toBe(true);
    sel = toggleGroup(sel, g);
    expect(sel.size).toBe(0);
    expect(toggleEveryone(new Set(), members).size).toBe(4);
    expect(toggleEveryone(new Set(members.map((m) => m.id)), members).size).toBe(0);
  });
});

const form = (o: Partial<SendForm> = {}): SendForm => ({ memberIds: ["m1"], startsOn: "2026-11-26", mode: "ongoing", weeks: "4", endsOn: "", note: "", ...o });

describe("send form", () => {
  it("is valid with one member and a start date", () => {
    expect(validateSend(form())).toEqual({});
  });
  it("asks for members, a date, weeks within 1..52, a last day not before the start, and a note within the limit", () => {
    expect(validateSend(form({ memberIds: [] })).members).toBeTruthy();
    expect(validateSend(form({ startsOn: "" })).startsOn).toBeTruthy();
    expect(validateSend(form({ mode: "weeks", weeks: "0" })).weeks).toBeTruthy();
    expect(validateSend(form({ mode: "weeks", weeks: "53" })).weeks).toBeTruthy();
    expect(validateSend(form({ mode: "weeks", weeks: "12" }))).toEqual({});
    expect(validateSend(form({ mode: "until", endsOn: "2026-11-01" })).endsOn).toBe("before");
    expect(validateSend(form({ mode: "until", endsOn: "2026-12-31" }))).toEqual({});
    expect(validateSend(form({ note: "x".repeat(NOTE_MAX + 1) })).note).toBeTruthy();
    expect(validateSend(form({ memberIds: Array.from({ length: 101 }, (_, i) => `m${i}`) })).members).toBe("tooMany");
  });
  it("builds the sendPlanToMembers body", () => {
    expect(buildSendPayload("p1", form({ memberIds: ["a", "a", "b"], note: "  Start Monday  " }))).toEqual({
      planId: "p1",
      memberIds: ["a", "b"],
      startsOn: "2026-11-26",
      repeat: { mode: "ongoing" },
      note: "Start Monday",
    });
    expect(buildSendPayload("p1", form({ mode: "weeks", weeks: "6" })).repeat).toEqual({ mode: "weeks", weeks: 6 });
    expect(buildSendPayload("p1", form({ mode: "until", endsOn: "2026-12-31" })).repeat).toEqual({ mode: "until", endsOn: "2026-12-31" });
    expect("note" in buildSendPayload("p1", form())).toBe(false);
  });
  it("works out the last day like the API does", () => {
    expect(repeatEnd(form({ mode: "ongoing" }))).toBeNull();
    expect(repeatEnd(form({ mode: "once" }))).toBe("2026-11-26");
    expect(repeatEnd(form({ mode: "weeks", weeks: "4" }))).toBe("2026-12-23");
    expect(repeatEnd(form({ mode: "until", endsOn: "2026-12-31" }))).toBe("2026-12-31");
    expect(repeatEnd(form({ mode: "weeks", weeks: "x" }))).toBeNull();
  });
});

describe("send results and link", () => {
  it("counts each outcome", () => {
    const r = (status: "sent" | "already_sent" | "skipped_active") => ({ memberId: status, memberName: status, status, assignmentId: "a" });
    expect(countResults([r("sent"), r("sent"), r("already_sent"), r("skipped_active")])).toEqual({ sent: 2, already: 1, skipped: 1 });
  });
  it("makes a member-safe link: the customer workouts page, nothing else", () => {
    expect(memberLink("https://gym.example.test/")).toBe("https://gym.example.test/customer/workouts");
    expect(memberLink("http://localhost:3000")).not.toMatch(/token|\?/);
  });
  it("shows a coach by first name", () => {
    expect(coachLabel("Ravi Kumar")).toBe("Ravi");
    expect(coachLabel("Sample Coach Alpha")).toBe("Alpha");
    expect(coachLabel(null)).toBe("");
  });
});
