import { describe, expect, it } from "vitest";
import { fromApi, MAX_SLOTS, newSlot, signature, toPayload, validateSlots } from "../lib/sessions/availability";
import { buildCancelPayload, buildCreatePayload, buildReschedulePayload, validateSchedule, validateWindow, type ScheduleInput } from "../lib/sessions/form";
import { addDays, groupByDate, isDateString, istDate, istTime, mondayOf, toInstant } from "../lib/sessions/week";

const base: ScheduleInput = { mode: "batch", batchId: "b1", memberId: "", date: "2026-11-23", startTime: "17:00", endTime: "18:00", capacity: "", title: "" };
const codes = (i: ScheduleInput) => validateSchedule(i).map((e) => `${e.field}:${e.code}`);

describe("schedule form validation (mirrors createSession)", () => {
  it("accepts a valid batch and one-on-one", () => {
    expect(validateSchedule(base)).toEqual([]);
    expect(validateSchedule({ ...base, mode: "member", batchId: "", memberId: "m1" })).toEqual([]);
  });
  it("needs the batch or the member that matches the mode", () => {
    expect(codes({ ...base, batchId: "" })).toEqual(["batchId:required"]);
    expect(codes({ ...base, mode: "member", memberId: "" })).toEqual(["memberId:required"]);
  });
  it("checks date and times", () => {
    expect(codes({ ...base, date: "" })).toContain("date:required");
    expect(codes({ ...base, date: "2026-02-31" })).toContain("date:dateFormat");
    expect(codes({ ...base, startTime: "25:00" })).toContain("startTime:timeFormat");
    expect(codes({ ...base, endTime: "17:00" })).toContain("endTime:endAfterStart");
    expect(codes({ ...base, startTime: "06:00", endTime: "18:30" })).toContain("endTime:tooLong");
    expect(validateWindow("2026-11-23", "06:00", "18:00")).toEqual([]);
  });
  it("capacity is 1..500, only for batch sessions; title up to 80", () => {
    expect(codes({ ...base, capacity: "0" })).toContain("capacity:capacityRange");
    expect(codes({ ...base, capacity: "501" })).toContain("capacity:capacityRange");
    expect(codes({ ...base, capacity: "2.5" })).toContain("capacity:capacityRange");
    expect(codes({ ...base, capacity: "12" })).toEqual([]);
    expect(codes({ ...base, mode: "member", batchId: "", memberId: "m", capacity: "abc" })).toEqual([]);
    expect(codes({ ...base, title: "x".repeat(81) })).toContain("title:titleLong");
  });
});

describe("payload building", () => {
  it("sends exactly one of batchId or memberId, IST instants and a clientId", () => {
    const b = buildCreatePayload({ ...base, capacity: "10", title: " Grading " }, "cid-1234567");
    expect(b).toEqual({ batchId: "b1", startsAt: "2026-11-23T11:30:00.000Z", endsAt: "2026-11-23T12:30:00.000Z", clientId: "cid-1234567", capacity: 10, title: "Grading" });
    const m = buildCreatePayload({ ...base, mode: "member", batchId: "", memberId: "m1", capacity: "10" }, "cid-1234567");
    expect(m).not.toHaveProperty("batchId");
    expect(m).not.toHaveProperty("capacity");
    expect(m.memberId).toBe("m1");
  });
  it("reschedule and cancel bodies", () => {
    expect(buildReschedulePayload("2026-11-24", "06:30", "07:30")).toEqual({ startsAt: "2026-11-24T01:00:00.000Z", endsAt: "2026-11-24T02:00:00.000Z" });
    expect(buildCancelPayload("  rain ")).toEqual({ status: "cancelled", cancelReason: "rain" });
    expect(buildCancelPayload("")).toEqual({ status: "cancelled" });
  });
});

describe("availability validation (mirrors replaceCoachAvailability)", () => {
  const s = (weekday: number, a: string, b: string) => newSlot(weekday, a, b);
  const errs = (slots: ReturnType<typeof newSlot>[]) => validateSlots(slots).errors.map((e) => `${e.index}:${e.field}:${e.code}`);

  it("accepts valid and touching ranges", () => {
    expect(errs([s(1, "09:00", "10:00"), s(1, "10:00", "11:00"), s(2, "09:00", "10:00")])).toEqual([]);
  });
  it("rejects bad times and end before start", () => {
    expect(errs([s(1, "", "10:00")])).toEqual(["0:startTime:required"]);
    expect(errs([s(1, "9am", "10:00")])).toEqual(["0:startTime:timeFormat"]);
    expect(errs([s(1, "10:00", "10:00")])).toEqual(["0:endTime:endAfterStart"]);
    expect(errs([s(1, "11:00", "10:00")])).toEqual(["0:endTime:endAfterStart"]);
  });
  it("rejects overlap on one weekday only", () => {
    expect(errs([s(1, "09:00", "10:30"), s(1, "10:00", "11:00")])).toEqual(["1:startTime:overlap"]);
    expect(errs([s(1, "09:00", "10:30"), s(2, "10:00", "11:00")])).toEqual([]);
  });
  it("allows at most 50 slots", () => {
    const many = Array.from({ length: MAX_SLOTS + 1 }, (_, i) => s((i % 7) + 1, "09:00", "09:30"));
    expect(validateSlots(many).tooMany).toBe(true);
  });
  it("payload is sorted and signature ignores keys", () => {
    const a = [s(2, "09:00", "10:00"), s(1, "15:00", "16:00"), s(1, "08:00", "09:00")];
    expect(toPayload(a).slots.map((x) => `${x.weekday}${x.startTime}`)).toEqual(["108:00", "115:00", "209:00"]);
    expect(signature(fromApi(toPayload(a).slots))).toBe(signature(a));
  });
});

describe("calendar helpers (IST)", () => {
  it("converts instants to tenant date and time", () => {
    expect(istDate("2026-11-22T19:00:00Z")).toBe("2026-11-23");
    expect(istTime("2026-11-23T11:30:00Z")).toBe("17:00");
    expect(toInstant("2026-11-23", "17:00")).toBe("2026-11-23T11:30:00.000Z");
  });
  it("finds Monday and adds days", () => {
    expect(mondayOf("2026-11-22")).toBe("2026-11-16"); // a Sunday
    expect(mondayOf("2026-11-23")).toBe("2026-11-23");
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(isDateString("2026-02-30")).toBe(false);
    expect(isDateString("2026-11-22")).toBe(true);
  });
  it("groups sessions by tenant day in time order", () => {
    const g = groupByDate([{ startsAt: "2026-11-23T12:00:00Z" }, { startsAt: "2026-11-22T19:00:00Z" }, { startsAt: "2026-11-23T01:00:00Z" }]);
    expect([...g.keys()]).toEqual(["2026-11-23"]);
    expect(g.get("2026-11-23")!.map((x) => x.startsAt)).toEqual(["2026-11-22T19:00:00Z", "2026-11-23T01:00:00Z", "2026-11-23T12:00:00Z"]);
  });
});
