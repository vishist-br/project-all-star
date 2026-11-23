/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { tryConnect } from "./helpers-db";
import { buildWorld, call, d, uniq, type World } from "./helpers-api";
import { GET as listRoute, POST as createRoute } from "../app/api/v1/holidays/route";
import { DELETE as deleteRoute } from "../app/api/v1/holidays/[holidayId]/route";
import { extendsTimeline } from "../lib/api/attendance";
import { isHoliday } from "../lib/api/session-detail";
import { forTenant } from "../lib/tenant-scope";
import { splitHolidays, validateHoliday, withHoliday } from "../components/owner/holidays/view-model";
import { messages } from "../lib/i18n";

describe("holiday editor view model", () => {
  it("validates date and name like the API", () => {
    expect(validateHoliday({ date: "", name: "Diwali" })).toMatchObject({ ok: false, errors: { date: "dateRequired" } });
    expect(validateHoliday({ date: "2026-02-30", name: "x" })).toMatchObject({ ok: false, errors: { date: "dateInvalid" } });
    expect(validateHoliday({ date: "2026-11-08", name: "  " })).toMatchObject({ ok: false, errors: { name: "nameRequired" } });
    expect(validateHoliday({ date: "2026-11-08", name: "x".repeat(81) })).toMatchObject({ ok: false, errors: { name: "nameLong" } });
    expect(validateHoliday({ date: "2026-11-08", name: " Diwali " })).toEqual({ ok: true, value: { date: "2026-11-08", name: "Diwali" } });
  });
  it("splits upcoming (soonest first) and past (latest first) and keeps date order on insert", () => {
    const items = [
      { id: "a", date: "2026-12-25", name: "A" },
      { id: "b", date: "2026-01-01", name: "B" },
      { id: "c", date: "2026-11-23", name: "C" },
      { id: "e", date: "2026-03-01", name: "E" },
    ];
    const { upcoming, past } = splitHolidays(items, "2026-11-23");
    expect(upcoming.map((h) => h.id)).toEqual(["c", "a"]);
    expect(past.map((h) => h.id)).toEqual(["e", "b"]);
    expect(withHoliday(items, { id: "z", date: "2026-02-01", name: "Z" }).map((h) => h.id)).toEqual(["b", "z", "e", "c", "a"]);
  });
  it("has en, hi and kn strings and no accountability or surveillance wording", () => {
    for (const loc of ["en", "hi", "kn"] as const) {
      const keys = Object.keys(messages[loc]).filter((k) => k.startsWith("hol."));
      expect(keys.length, loc).toBe(Object.keys(messages.en).filter((k) => k.startsWith("hol.")).length);
      for (const k of keys) expect((messages[loc] as any)[k].toLowerCase()).not.toMatch(/accountab|surveil/);
    }
  });
});

describe("holidays API (local Postgres)", () => {
  let prisma: PrismaClient | null = null;
  let world: World;

  beforeAll(async () => {
    prisma = await tryConnect();
    if (prisma) world = await buildWorld(prisma, "star94");
  });
  afterAll(async () => {
    if (!prisma) return;
    await world?.cleanup();
    await prisma.$disconnect();
  });

  it("owner adds, lists and removes a day; duplicates conflict; bad input is 400", async (ctx) => {
    if (!prisma) return ctx.skip();
    const { A } = world;
    const date = d(200 + Math.floor(Math.random() * 50));
    const name = `Closure ${uniq()}`;
    const created = await call(createRoute, "POST", "/holidays", A.token.owner, { body: { date, name: `  ${name} ` } });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ date, name });

    const dup = await call(createRoute, "POST", "/holidays", A.token.owner, { body: { date, name: "Again" } });
    expect(dup.status).toBe(409);

    for (const body of [{}, { date: "2026-13-01", name: "x" }, { date, name: "" }, { date: "2030-01-01", name: "x", extra: 1 }, { date: "2030-01-01", name: "x".repeat(81) }]) {
      const bad = await call(createRoute, "POST", "/holidays", A.token.owner, { body });
      expect(bad.status, JSON.stringify(body)).toBe(400);
    }

    const list = await call(listRoute, "GET", `/holidays?from=${date}&to=${date}`, A.token.owner);
    expect(list.status).toBe(200);
    expect(list.body.items).toEqual([created.body]);
    expect((await call(listRoute, "GET", "/holidays?from=nope", A.token.owner)).status).toBe(400);

    const del = await call(deleteRoute, "DELETE", `/holidays/${created.body.id}`, A.token.owner, { params: { holidayId: created.body.id } });
    expect(del.status).toBe(204);
    const gone = await call(deleteRoute, "DELETE", `/holidays/${created.body.id}`, A.token.owner, { params: { holidayId: created.body.id } });
    expect(gone.status).toBe(404);
  });

  it("coach, customer and anonymous are refused", async (ctx) => {
    if (!prisma) return ctx.skip();
    const { A } = world;
    const id = await A.fresh.holiday();
    for (const token of [A.token.coach, A.token.parent]) {
      expect((await call(listRoute, "GET", "/holidays", token)).status).toBe(403);
      expect((await call(createRoute, "POST", "/holidays", token, { body: { date: d(250), name: "x" } })).status).toBe(403);
      expect((await call(deleteRoute, "DELETE", `/holidays/${id}`, token, { params: { holidayId: id } })).status).toBe(403);
    }
    expect((await call(listRoute, "GET", "/holidays", undefined)).status).toBe(401);
    expect(await prisma.holiday.findUnique({ where: { id } })).not.toBeNull();
  });

  it("is tenant scoped: the same date can exist in two tenants and one cannot delete the other's day", async (ctx) => {
    if (!prisma) return ctx.skip();
    const { A, B } = world;
    const date = d(260);
    expect((await call(createRoute, "POST", "/holidays", A.token.owner, { body: { date, name: "A day" } })).status).toBe(201);
    expect((await call(createRoute, "POST", "/holidays", B.token.owner, { body: { date, name: "B day" } })).status).toBe(201);
    const aList = await call(listRoute, "GET", `/holidays?from=${date}&to=${date}`, A.token.owner);
    expect(aList.body.items.map((h: any) => h.name)).toEqual(["A day"]);
    const bId = (await prisma.holiday.findFirstOrThrow({ where: { tenantId: B.id, date: new Date(`${date}T00:00:00Z`) } })).id;
    const cross = await call(deleteRoute, "DELETE", `/holidays/${bId}`, A.token.owner, { params: { holidayId: bId } });
    expect(cross.status).toBe(404);
    expect(await prisma.holiday.findUnique({ where: { id: bId } })).not.toBeNull();
  });

  it("a calendar day counts as a holiday for sessions (isHoliday) and does not extend the timeline", async (ctx) => {
    if (!prisma) return ctx.skip();
    const { A } = world;
    const date = d(270);
    await call(createRoute, "POST", "/holidays", A.token.owner, { body: { date, name: "Closure" } });
    const db = forTenant(prisma, A.id);
    expect(await isHoliday(db, new Date(`${date}T06:30:00Z`))).toBe(true);
    expect(await isHoliday(db, new Date(`${d(271)}T06:30:00Z`))).toBe(false);
    expect(extendsTimeline("ABSENT", true)).toBe(false);
    expect(extendsTimeline("ABSENT", false)).toBe(true);
  });
});
