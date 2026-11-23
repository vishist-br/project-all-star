/**
 * STAR-96: parent weekly progress card. Pure rules (names, weeks, framing), the card API
 * (attendance, level, goals, streak, coach note), who may write the note, and the public tokenised
 * card: first name only, no other names, revocable, expiring, tenant-bound. Fake data only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { tryConnect } from "./helpers-db";
import { validateSchemaName } from "./contract-schema";
import { buildWorld, call, tenantIds, uniq, type World } from "./helpers-api";
import { hashToken } from "../lib/auth/tokens";
import { LINK_LIFETIME_DAYS, TOKEN_PATTERN, cheerFor, firstNameOf, isMonday, linkExpiry, mondayOf, scrubNames, weekEndOf } from "../lib/progress-card/rules";
import { en } from "../lib/i18n/messages/en";
import { hi } from "../lib/i18n/messages/hi";
import { kn } from "../lib/i18n/messages/kn";
import { GET as cardRoute } from "../app/api/v1/members/[memberId]/progress-card/route";
import { GET as noteGet, PUT as notePut } from "../app/api/v1/members/[memberId]/progress-card/note/route";
import { GET as linksGet, POST as linksPost } from "../app/api/v1/members/[memberId]/progress-card/links/route";
import { POST as revokeRoute } from "../app/api/v1/progress-card-links/[linkId]/revoke/route";
import { GET as publicRoute } from "../app/api/v1/progress-cards/[token]/route";

/* eslint-disable @typescript-eslint/no-explicit-any */

describe("progress card rules (pure)", () => {
  it("uses the first word of a name only", () => {
    expect(firstNameOf("Sample Aarav Kulkarni")).toBe("Sample");
    expect(firstNameOf("  Aarav   Kulkarni ")).toBe("Aarav");
    expect(firstNameOf("Aarav")).toBe("Aarav");
  });

  it("scrubs full names from free text: member full name becomes first name, surname and guardian are dropped", () => {
    const out = scrubNames("Aarav Kulkarni kicked well. Tell Meera Kulkarni, and Kulkarni family!", "Aarav Kulkarni", "Meera Kulkarni");
    expect(out).not.toMatch(/Kulkarni|Meera/);
    expect(out).toContain("Aarav kicked well.");
  });

  it("leaves text without names alone, and does not touch partial words", () => {
    expect(scrubNames("Great focus today.", "Aarav Kulkarni")).toBe("Great focus today.");
    expect(scrubNames("Kulkarnis are great", "Aarav Kulkarni")).toBe("Kulkarnis are great");
  });

  it("weeks start on Monday", () => {
    expect(mondayOf("2026-11-23")).toBe("2026-11-23");
    expect(mondayOf("2026-11-29")).toBe("2026-11-23");
    expect(mondayOf("2026-11-25")).toBe("2026-11-23");
    expect(isMonday("2026-11-23")).toBe(true);
    expect(isMonday("2026-11-24")).toBe(false);
    expect(weekEndOf("2026-11-23")).toBe("2026-11-29");
  });

  it("framing is encouraging whatever the week was", () => {
    expect(cheerFor(3, 3, 3)).toBe("great");
    expect(cheerFor(2, 3, 0)).toBe("steady");
    expect(cheerFor(0, 2, 0)).toBe("restart");
    expect(cheerFor(0, 0, 0)).toBe("quiet");
  });

  it("links expire after the lifetime, and the token pattern matches a real token", () => {
    const now = new Date("2026-11-23T00:00:00Z");
    expect(linkExpiry(now).getTime() - now.getTime()).toBe(LINK_LIFETIME_DAYS * 86_400_000);
    expect(TOKEN_PATTERN.test("x".repeat(43))).toBe(true);
    expect(TOKEN_PATTERN.test("short")).toBe(false);
  });

  it("copy is about visibility and progress: no accountability or surveillance wording, hi and kn complete", () => {
    for (const [name, dict] of [["en", en], ["hi", hi], ["kn", kn]] as const) {
      const keys = Object.keys(dict).filter((k) => k.startsWith("pc."));
      expect(keys.length, name).toBeGreaterThan(50);
      for (const k of keys) expect((dict as Record<string, string>)[k], `${name} ${k}`).not.toMatch(/accountab|surveil|monitor|track(ing)? your/i);
    }
    expect(Object.keys(hi).filter((k) => k.startsWith("pc.")).sort()).toEqual(Object.keys(en).filter((k) => k.startsWith("pc.")).sort());
    expect(Object.keys(kn).filter((k) => k.startsWith("pc.")).sort()).toEqual(Object.keys(en).filter((k) => k.startsWith("pc.")).sort());
  });
});

describe("progress card API and public link (local Postgres)", () => {
  let prisma: PrismaClient | null = null;
  let world: World;
  const SURNAME = "Kulkarni";
  const GUARDIAN = "Meera Kulkarni";

  beforeAll(async () => {
    prisma = await tryConnect();
    if (!prisma) return;
    world = await buildWorld(prisma, "star96");
    const { A, B } = world;
    for (const [fx, kid] of [[A, "Aarav Kulkarni"], [B, "Bina Banerjee"]] as const) {
      await prisma.member.update({ where: { id: fx.ids.kid }, data: { displayName: kid } });
    }
    await prisma.guardian.updateMany({ where: { tenantId: A.id }, data: { name: GUARDIAN } });
    // One completed session today with the kid present, so the card has attendance and a streak.
    const start = new Date(Date.now() - 30 * 60_000);
    const s = await prisma.session.create({
      data: { tenantId: A.id, batchId: A.ids.batch1, coachId: A.user.coach, startsAt: start, endsAt: new Date(start.getTime() + 25 * 60_000), status: "COMPLETED" },
    });
    await prisma.attendance.create({ data: { tenantId: A.id, sessionId: s.id, memberId: A.ids.kid, status: "PRESENT", clientId: `star96-${uniq()}`, markedById: A.user.coach } });
  });
  afterAll(async () => {
    if (!prisma) return;
    await world?.cleanup();
    await prisma.$disconnect();
  });

  const getCard = (token: string | undefined, memberId: string, query = "") =>
    call(cardRoute, "GET", `/members/${memberId}/progress-card${query}`, token, { params: { memberId } });
  const putNote = (token: string | undefined, memberId: string, body: unknown) =>
    call(notePut, "PUT", `/members/${memberId}/progress-card/note`, token, { params: { memberId }, body });
  const makeLink = (token: string, memberId: string, body: unknown = {}) =>
    call(linksPost, "POST", `/members/${memberId}/progress-card/links`, token, { params: { memberId }, body });
  const openPublic = (tok: string) => call(publicRoute, "GET", `/progress-cards/${tok}`, undefined, { params: { token: tok } });

  it("the family sees attendance, a streak and level or goal progress, in the contract shape, without a missed count", async (ctx) => {
    if (!prisma) return ctx.skip();
    const { A } = world;
    const r = await getCard(A.token.parent, A.ids.kid);
    expect(r.status).toBe(200);
    expect(validateSchemaName(r.body, "ProgressCard")).toEqual([]);
    expect(r.body.firstName).toBe("Aarav");
    expect(r.body.attendance.attended).toBe(1);
    expect(r.body.attendance.held).toBeGreaterThanOrEqual(1);
    expect(r.body.streak.currentDays).toBeGreaterThanOrEqual(1);
    expect(r.body.goals.map((g: any) => g.title)).toContain("Fixture goal");
    expect(JSON.stringify(r.body)).not.toMatch(/missed|absent/i);
    expect(isMonday(r.body.weekStart)).toBe(true);
  });

  it("only a first name and no other member's data: not the surname, guardian, ids or another family's card", async (ctx) => {
    if (!prisma) return ctx.skip();
    const { A, B } = world;
    const r = await getCard(A.token.parent, A.ids.kid);
    expect(r.text).not.toContain(SURNAME);
    expect(r.text).not.toContain(GUARDIAN);
    expect((await getCard(A.token.stranger, A.ids.kid)).status).toBe(403);
    expect((await getCard(A.token.parent, B.ids.kid)).status).toBe(404);
    expect((await getCard(undefined, A.ids.kid)).status).toBe(401);
  });

  it("week must be a past or current Monday", async (ctx) => {
    if (!prisma) return ctx.skip();
    const { A } = world;
    expect((await getCard(A.token.parent, A.ids.kid, "?week=2026-11-24")).status).toBe(400);
    expect((await getCard(A.token.parent, A.ids.kid, "?week=2099-01-05")).status).toBe(400);
    expect((await getCard(A.token.parent, A.ids.kid, "?week=nope")).status).toBe(400);
    expect((await getCard(A.token.parent, A.ids.kid, "?week=2026-11-16")).status).toBe(200);
  });

  it("the coach of the member writes the note; another coach, the parent and other tenants cannot", async (ctx) => {
    if (!prisma) return ctx.skip();
    const { A, B } = world;
    const body = { note: "Aarav Kulkarni showed great focus. Meera Kulkarni, please cheer him on!" };
    expect((await putNote(A.token.parent, A.ids.kid, body)).status).toBe(403);
    expect((await putNote(A.token.coachX, A.ids.kid, body)).status).toBe(403);
    expect((await putNote(B.token.coach, A.ids.kid, body)).status).toBe(404);
    expect((await putNote(A.token.coach, A.ids.kid, { note: "x".repeat(281) })).status).toBe(400);
    expect((await putNote(A.token.coach, A.ids.kid, { note: "ok", extra: 1 })).status).toBe(400);
    const saved = await putNote(A.token.coach, A.ids.kid, body);
    expect(saved.status).toBe(200);
    expect(saved.body.note).toBe(body.note); // the coach sees what they wrote

    const asParent = await getCard(A.token.parent, A.ids.kid);
    expect(asParent.body.coachNote).toContain("Aarav showed great focus");
    expect(asParent.text).not.toContain(SURNAME);
    expect(asParent.text).not.toContain("Meera");

    const read = await call(noteGet, "GET", "", A.token.coach, { params: { memberId: A.ids.kid } });
    expect(read.body.note).toBe(body.note);
    expect((await call(noteGet, "GET", "", A.token.parent, { params: { memberId: A.ids.kid } })).status).toBe(403);
  });

  it("an empty note removes it, and saving twice keeps one row for the week", async (ctx) => {
    if (!prisma) return ctx.skip();
    const { A } = world;
    await putNote(A.token.coach, A.ids.kid, { note: "First" });
    await putNote(A.token.coach, A.ids.kid, { note: "Second" });
    expect(await prisma.progressNote.count({ where: { tenantId: A.id, memberId: A.ids.kid } })).toBe(1);
    expect((await putNote(A.token.coach, A.ids.kid, { note: "   " })).body.note).toBeNull();
    expect(await prisma.progressNote.count({ where: { tenantId: A.id, memberId: A.ids.kid } })).toBe(0);
  });

  describe("public tokenised card", () => {
    it("works without sign-in, shows first name only and nothing else identifying", async (ctx) => {
      if (!prisma) return ctx.skip();
      const { A, B } = world;
      await putNote(A.token.coach, A.ids.kid, { note: "Aarav Kulkarni is improving. Meera Kulkarni is welcome to watch." });
      const made = await makeLink(A.token.parent, A.ids.kid);
      expect(made.status).toBe(201);
      expect(made.body.path).toBe(`/card/${made.body.token}`);
      expect(TOKEN_PATTERN.test(made.body.token)).toBe(true);

      const pub = await openPublic(made.body.token);
      expect(pub.status).toBe(200);
      expect(validateSchemaName(pub.body, "ProgressCard")).toEqual([]);
      expect(pub.body.firstName).toBe("Aarav");
      expect(pub.body.coachNote).toContain("Aarav is improving");
      for (const secret of [SURNAME, GUARDIAN, "Meera", A.ids.kid, A.id, A.user.parent, A.user.coach, "qa.example.test", "guardian"]) {
        expect(pub.text, `leaked ${secret}`).not.toContain(secret);
      }
      // nothing of the other tenant, and no photo or phone field exists in the shape
      for (const id of await tenantIds(prisma, B.id)) expect(pub.text).not.toContain(id);
      expect(pub.text).not.toMatch(/photo|phone|email|birth/i);
      expect(Object.keys(pub.body).sort()).toEqual(["attendance", "coachNote", "firstName", "goals", "level", "streak", "tenantName", "weekEnd", "weekStart"].sort());
    });

    it("the token is the only secret: only a hash is stored, the list never returns it, malformed and unknown tokens are 404", async (ctx) => {
      if (!prisma) return ctx.skip();
      const { A } = world;
      const made = await makeLink(A.token.parent, A.ids.kid);
      const row = await prisma.progressCardLink.findFirstOrThrow({ where: { id: made.body.id } });
      expect(row.tokenHash).toBe(hashToken(made.body.token));
      expect(JSON.stringify(row)).not.toContain(made.body.token);
      const listed = await call(linksGet, "GET", "", A.token.parent, { params: { memberId: A.ids.kid } });
      expect(listed.status).toBe(200);
      expect(listed.text).not.toContain(made.body.token);
      expect(listed.body.items.map((l: any) => l.id)).toContain(made.body.id);
      for (const bad of ["nope", "x".repeat(43), made.body.token.slice(0, -1) + (made.body.token.endsWith("A") ? "B" : "A"), "../../etc/passwd"]) {
        const r = await openPublic(bad);
        expect(r.status, bad).toBe(404);
        expect(validateSchemaName(r.body, "Error")).toEqual([]);
      }
    });

    it("revoking stops the link at once; revoking twice is safe; another family or tenant cannot revoke", async (ctx) => {
      if (!prisma) return ctx.skip();
      const { A, B } = world;
      const made = await makeLink(A.token.parent, A.ids.kid);
      expect((await openPublic(made.body.token)).status).toBe(200);
      const revoke = (token: string) => call(revokeRoute, "POST", "", token, { params: { linkId: made.body.id } });
      expect((await revoke(A.token.stranger)).status).toBe(403);
      expect((await revoke(B.token.parent)).status).toBe(404);
      expect((await openPublic(made.body.token)).status).toBe(200);
      const first = await revoke(A.token.parent);
      expect(first.status).toBe(200);
      expect(first.body.status).toBe("revoked");
      expect((await revoke(A.token.parent)).status).toBe(200);
      const after = await openPublic(made.body.token);
      expect(after.status).toBe(404);
      const listed = await call(linksGet, "GET", "", A.token.parent, { params: { memberId: A.ids.kid } });
      expect(listed.body.items.map((l: any) => l.id)).not.toContain(made.body.id);
    });

    it("an expired link is the same 404 as an unknown one", async (ctx) => {
      if (!prisma) return ctx.skip();
      const { A } = world;
      const made = await makeLink(A.token.parent, A.ids.kid);
      await prisma.progressCardLink.update({ where: { id: made.body.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      const r = await openPublic(made.body.token);
      expect(r.status).toBe(404);
      expect(r.body).toEqual((await openPublic("y".repeat(43))).body);
    });

    it("a link only ever shows its own member and week; tenant B's link never shows tenant A's data", async (ctx) => {
      if (!prisma) return ctx.skip();
      const { A, B } = world;
      const made = await makeLink(B.token.parent, B.ids.kid);
      const pub = await openPublic(made.body.token);
      expect(pub.body.firstName).toBe("Bina");
      expect(pub.body.tenantName).toBe(`QA star96 B`);
      for (const id of await tenantIds(prisma, A.id)) expect(pub.text).not.toContain(id);
      expect(pub.text).not.toContain("Aarav");
      // B's coach cannot create a link on A's member
      expect((await makeLink(B.token.coach, A.ids.kid)).status).toBe(404);
    });

    it("the link rows are tenant-scoped and capped per member", async (ctx) => {
      if (!prisma) return ctx.skip();
      const { A } = world;
      await prisma.progressCardLink.updateMany({ where: { tenantId: A.id }, data: { revokedAt: new Date() } });
      for (let i = 0; i < 10; i++) expect((await makeLink(A.token.owner, A.ids.kid)).status).toBe(201);
      const over = await makeLink(A.token.owner, A.ids.kid);
      expect(over.status).toBe(409);
      expect(validateSchemaName(over.body, "Error")).toEqual([]);
    });
  });
});
