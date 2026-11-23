/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { tryConnect } from "./helpers-db";
import { buildWorld, call, uniq, type World } from "./helpers-api";
import { GET as listRoute, POST as createRoute } from "../app/api/v1/coaches/[coachId]/credentials/route";
import { DELETE as deleteRoute, PATCH as patchRoute } from "../app/api/v1/coach-credentials/[credentialId]/route";
import { credentialCounts, sortCredentials, validateCredential } from "../components/coach/credentials/view-model";
import { listMyCoachesWithCredentials } from "../lib/api/coach-credentials";
import { forTenant } from "../lib/tenant-scope";
import { messages } from "../lib/i18n";

const THIS_YEAR = new Date().getUTCFullYear();

describe("credential form view model", () => {
  it("validates like the API", () => {
    expect(validateCredential({ title: " ", issuer: "", year: "" }, THIS_YEAR)).toMatchObject({ ok: false, errors: { title: "titleRequired" } });
    expect(validateCredential({ title: "x".repeat(81), issuer: "", year: "" }, THIS_YEAR)).toMatchObject({ ok: false, errors: { title: "titleLong" } });
    expect(validateCredential({ title: "Cert", issuer: "", year: "19" }, THIS_YEAR)).toMatchObject({ ok: false, errors: { year: "yearInvalid" } });
    expect(validateCredential({ title: "Cert", issuer: "", year: String(THIS_YEAR + 1) }, THIS_YEAR)).toMatchObject({ ok: false, errors: { year: "yearInvalid" } });
    expect(validateCredential({ title: " Cert ", issuer: " Board ", year: "2020" }, THIS_YEAR)).toEqual({ ok: true, value: { title: "Cert", issuer: "Board", year: 2020 } });
    expect(validateCredential({ title: "Cert", issuer: "", year: "" }, THIS_YEAR)).toEqual({ ok: true, value: { title: "Cert" } });
  });
  it("sorts verified first and counts both states", () => {
    const mk = (id: string, verified: boolean) => ({ id, coachId: "c", title: id, issuer: null, year: null, verified, verifiedAt: verified ? "2026-11-01T00:00:00.000Z" : null });
    const items = [mk("a", false), mk("b", true), mk("c", false)];
    expect(sortCredentials(items).map((c) => c.id)).toEqual(["b", "a", "c"]);
    expect(credentialCounts(items)).toEqual({ verified: 1, unverified: 2 });
  });
  it("has en, hi and kn strings with no accountability or surveillance wording", () => {
    const enKeys = Object.keys(messages.en).filter((k) => k.startsWith("cred."));
    expect(enKeys.length).toBeGreaterThan(20);
    for (const loc of ["en", "hi", "kn"] as const) {
      const keys = Object.keys(messages[loc]).filter((k) => k.startsWith("cred."));
      expect(keys.length, loc).toBe(enKeys.length);
      for (const k of keys) expect((messages[loc] as any)[k].toLowerCase()).not.toMatch(/accountab|surveil/);
    }
  });
});

describe("coach credentials API (local Postgres)", () => {
  let prisma: PrismaClient | null = null;
  let world: World;

  beforeAll(async () => {
    prisma = await tryConnect();
    if (prisma) world = await buildWorld(prisma, "star97");
  });
  afterAll(async () => {
    if (!prisma) return;
    await world?.cleanup();
    await prisma.$disconnect();
  });

  const list = (token: string | undefined, coachId: string) => call(listRoute, "GET", `/coaches/${coachId}/credentials`, token, { params: { coachId } });
  const add = (token: string | undefined, coachId: string, body: unknown) => call(createRoute, "POST", `/coaches/${coachId}/credentials`, token, { body, params: { coachId } });
  const verify = (token: string | undefined, id: string, verified: unknown) => call(patchRoute, "PATCH", `/coach-credentials/${id}`, token, { body: { verified }, params: { credentialId: id } });
  const remove = (token: string | undefined, id: string) => call(deleteRoute, "DELETE", `/coach-credentials/${id}`, token, { params: { credentialId: id } });

  it("a coach adds a claimed credential: it shows unverified until the owner verifies, and unverifying reverses it", async (ctx) => {
    if (!prisma) return ctx.skip();
    const { A } = world;
    const title = `Karate Instructor ${uniq()}`;
    const created = await add(A.token.coach, A.user.coach, { title: `  ${title} `, issuer: "Demo Board", year: 2021 });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ coachId: A.user.coach, title, issuer: "Demo Board", year: 2021, verified: false, verifiedAt: null });

    // The coach cannot verify their own claim.
    expect((await verify(A.token.coach, created.body.id, true)).status).toBe(403);
    expect((await prisma.coachCredential.findUniqueOrThrow({ where: { id: created.body.id } })).verifiedAt).toBeNull();

    const ok = await verify(A.token.owner, created.body.id, true);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ id: created.body.id, verified: true });
    expect(ok.body.verifiedAt).toEqual(expect.any(String));
    const row = await prisma.coachCredential.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(row.verifiedById).toBe(A.user.owner);

    const undone = await verify(A.token.owner, created.body.id, false);
    expect(undone.body).toMatchObject({ verified: false, verifiedAt: null });
    expect((await prisma.coachCredential.findUniqueOrThrow({ where: { id: created.body.id } })).verifiedById).toBeNull();
  });

  it("validates input", async (ctx) => {
    if (!prisma) return ctx.skip();
    const { A } = world;
    const bad: unknown[] = [{}, { title: "" }, { title: "x".repeat(81) }, { title: "ok", year: 1900 }, { title: "ok", year: 2.5 }, { title: "ok", year: THIS_YEAR + 1 }, { title: "ok", issuer: "x".repeat(81) }, { title: "ok", verified: true }];
    for (const body of bad) expect((await add(A.token.coach, A.user.coach, body)).status, JSON.stringify(body)).toBe(400);
    for (const v of [undefined, "yes", 1, null]) expect((await verify(A.token.owner, await A.fresh.credential(), v)).status, String(v)).toBe(400);
  });

  it("role and row rules: only the owner verifies; a coach manages only their own; customers read only their coaches", async (ctx) => {
    if (!prisma) return ctx.skip();
    const { A } = world;
    const id = await A.fresh.credential();
    // Another coach cannot read, add or remove.
    expect((await list(A.token.coachX, A.user.coach)).status).toBe(403);
    expect((await add(A.token.coachX, A.user.coach, { title: "Not mine" })).status).toBe(403);
    expect((await remove(A.token.coachX, id)).status).toBe(403);
    expect(await prisma.coachCredential.findUnique({ where: { id } })).not.toBeNull();
    // Customers cannot write; the parent of a kid in this coach's batch can read, an unrelated customer cannot.
    expect((await add(A.token.parent, A.user.coach, { title: "x" })).status).toBe(403);
    expect((await verify(A.token.parent, id, true)).status).toBe(403);
    expect((await remove(A.token.parent, id)).status).toBe(403);
    const parentView = await list(A.token.parent, A.user.coach);
    expect(parentView.status).toBe(200);
    expect(parentView.body.items.map((c: any) => c.id)).toContain(id);
    expect((await list(A.token.stranger, A.user.coach)).status).toBe(403);
    // Anonymous.
    expect((await list(undefined, A.user.coach)).status).toBe(401);
    expect((await verify(undefined, id, true)).status).toBe(401);
    // Coach removes own; owner removes any.
    expect((await remove(A.token.coach, id)).status).toBe(204);
    expect((await remove(A.token.coach, id)).status).toBe(404);
    const second = await A.fresh.credential();
    expect((await remove(A.token.owner, second)).status).toBe(204);
  });

  it("is tenant scoped: another business's ids are 404 and nothing changes", async (ctx) => {
    if (!prisma) return ctx.skip();
    const { A, B } = world;
    const bId = await B.fresh.credential();
    expect((await verify(A.token.owner, bId, true)).status).toBe(404);
    expect((await remove(A.token.owner, bId)).status).toBe(404);
    expect((await list(A.token.owner, B.user.coach)).status).toBe(404);
    expect((await add(A.token.owner, B.user.coach, { title: "Cross" })).status).toBe(404);
    const row = await prisma.coachCredential.findUniqueOrThrow({ where: { id: bId } });
    expect(row.verifiedAt).toBeNull();
    // Lists never mix tenants.
    const aList = await list(A.token.owner, A.user.coach);
    expect(aList.body.items.every((c: any) => c.coachId === A.user.coach)).toBe(true);
    // The owner cannot list a customer or an owner user id as a coach.
    expect((await list(A.token.owner, A.user.parent)).status).toBe(404);
  });

  it("caps credentials per coach", async (ctx) => {
    if (!prisma) return ctx.skip();
    const { B } = world;
    const have = await prisma.coachCredential.count({ where: { coachId: B.user.coachX } });
    for (let i = have; i < 20; i++) expect((await add(B.token.coachX, B.user.coachX, { title: `Cap ${i}` })).status).toBe(201);
    expect((await add(B.token.coachX, B.user.coachX, { title: "One too many" })).status).toBe(409);
  });

  it("member-facing coach info lists only coaches who teach the family, with both states", async (ctx) => {
    if (!prisma) return ctx.skip();
    const { A } = world;
    await A.fresh.credential();
    await prisma.coachCredential.create({ data: { tenantId: A.id, coachId: A.user.coach, title: "Verified one", verifiedAt: new Date(), verifiedById: A.user.owner } });
    const db = forTenant(prisma, A.id);
    const mine = await listMyCoachesWithCredentials(db, { userId: A.user.parent, tenantId: A.id, role: "customer" });
    expect(mine.map((c) => c.coachId)).toEqual([A.user.coach]);
    expect(mine[0]!.credentials.some((c) => c.verified)).toBe(true);
    expect(mine[0]!.credentials.some((c) => !c.verified)).toBe(true);
    const none = await listMyCoachesWithCredentials(db, { userId: A.user.stranger, tenantId: A.id, role: "customer" });
    expect(none.map((c) => c.coachId)).toEqual([A.user.coachX]);
  });
});
