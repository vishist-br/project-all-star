/**
 * Tenant isolation and role access suite (STAR-32). Run with `npm run test:isolation`.
 * Calls the real route handlers in app/api/v1 against two fresh fake tenants (A and B).
 * Complements, and does not repeat: read-endpoints.test.ts (list/detail role views, pagination),
 * members-import-api.test.ts (import logic), theme.test.ts (theme PUT roles), auth-policy.test.ts
 * (policy table vs openapi) and magic-link.test.ts (token lifecycle).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createMagicLink, exchangeMagicLink } from "../lib/auth/magic-link";
import { hashToken } from "../lib/auth/tokens";
import { tryConnect } from "./helpers-db";
import { validateSchemaName } from "./contract-schema";
import { GET as getTenant } from "../app/api/v1/tenant/route";
import { PUT as putTheme } from "../app/api/v1/tenant/theme/route";
import { GET as getPublicTheme } from "../app/api/v1/tenants/[tenantSlug]/theme/route";
import { GET as getMe } from "../app/api/v1/me/route";
import { POST as signOut } from "../app/api/v1/auth/sign-out/route";
import { POST as refresh } from "../app/api/v1/auth/refresh/route";
import { POST as exchange } from "../app/api/v1/auth/magic-link/exchange/route";
import { POST as devMagicLink } from "../app/api/v1/dev/magic-link/route";
import { GET as listMembers } from "../app/api/v1/members/route";
import { GET as getMember } from "../app/api/v1/members/[memberId]/route";
import { GET as listBatches } from "../app/api/v1/batches/route";
import { GET as listSessions } from "../app/api/v1/sessions/route";
import { POST as importMembers } from "../app/api/v1/members/import/route";

type Handler = (...args: any[]) => Promise<Response>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Who = "ownerA" | "coachA" | "coachA2" | "parentA" | "adultA" | "ownerB" | "coachB" | "customerB";

describe("tenant isolation and role access (local Postgres)", () => {
  let prisma: PrismaClient | null = null;
  const sfx = Date.now().toString(36);
  const tenant: Record<"A" | "B", { id: string; slug: string }> = { A: { id: "", slug: `iso-a-${sfx}` }, B: { id: "", slug: `iso-b-${sfx}` } };
  const tok = {} as Record<Who, { access: string; refresh: string }>;
  const uid: Record<string, string> = {};
  const mem: Record<string, string> = {};
  const bat: Record<string, string> = {};
  const ven: Record<string, string> = {};

  beforeAll(async () => {
    prisma = await tryConnect();
    if (!prisma) return;
    const db = prisma;
    for (const k of ["A", "B"] as const) tenant[k].id = (await db.tenant.create({ data: { slug: tenant[k].slug, name: `Iso ${k}` } })).id;
    await db.tenantTheme.create({ data: { tenantId: tenant.A.id, primaryColor: "#7A1D1D", secondaryColor: "#222222", accentColor: "#FFC107", logoUrl: "https://example.test/a.png" } });
    await db.tenantTheme.create({ data: { tenantId: tenant.B.id, primaryColor: "#0B5D3B", secondaryColor: "#111827", accentColor: null, logoUrl: null, defaultLocale: "hi" } });

    const mkUser = async (key: Who, t: "A" | "B", role: "OWNER" | "COACH" | "CUSTOMER") => {
      const u = await db.user.create({ data: { tenantId: tenant[t].id, role, email: `${key}@${t}.example.test`, name: `Fake ${key}` } });
      uid[key] = u.id;
      const s = await exchangeMagicLink((await createMagicLink(u.id, tenant[t].id)).token);
      tok[key] = { access: s.accessToken, refresh: s.refreshToken };
    };
    await mkUser("ownerA", "A", "OWNER");
    await mkUser("coachA", "A", "COACH");
    await mkUser("coachA2", "A", "COACH");
    await mkUser("parentA", "A", "CUSTOMER");
    await mkUser("adultA", "A", "CUSTOMER");
    await mkUser("ownerB", "B", "OWNER");
    await mkUser("coachB", "B", "COACH");
    await mkUser("customerB", "B", "CUSTOMER");

    for (const t of ["A", "B"] as const) {
      ven[t] = (await db.venue.create({ data: { tenantId: tenant[t].id, name: `Venue ${t}` } })).id;
      const sport = await db.sport.create({ data: { tenantId: tenant[t].id, slug: "karate", name: "Karate" } });
      const coach = t === "A" ? uid.coachA : uid.coachB;
      const mkBatch = async (key: string, coachId: string) => {
        bat[key] = (await db.batch.create({ data: { tenantId: tenant[t].id, coachId, venueId: ven[t], sportId: sport.id, name: `Batch ${key}`, daysOfWeek: [1], startTime: "18:00", endTime: "19:00" } })).id;
        await db.session.create({ data: { tenantId: tenant[t].id, batchId: bat[key], coachId, startsAt: new Date("2026-10-19T12:30:00Z"), endsAt: new Date("2026-10-19T13:30:00Z"), status: "COMPLETED" } });
      };
      await mkBatch(`${t}1`, coach);
      if (t === "A") await mkBatch("A2", uid.coachA2);
    }
    const guardian = await db.guardian.create({ data: { tenantId: tenant.A.id, userId: uid.parentA, name: "Fake Parent" } });
    const mkMember = async (key: string, t: "A" | "B", batch: string, data: object) => {
      mem[key] = (await db.member.create({ data: { tenantId: tenant[t].id, displayName: key, ...data } })).id;
      await db.batchMember.create({ data: { tenantId: tenant[t].id, batchId: batch, memberId: mem[key] } });
    };
    await mkMember("kidA", "A", bat.A1, { isMinor: true, guardianId: guardian.id });
    await mkMember("adultA", "A", bat.A1, { userId: uid.adultA });
    await mkMember("otherA", "A", bat.A2, {});
    await mkMember("memberB", "B", bat.B1, { userId: uid.customerB });
  });

  afterAll(async () => {
    if (!prisma) return;
    const ids = [tenant.A.id, tenant.B.id];
    await prisma.magicLink.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.authSession.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.tenantTheme.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  const bearer = (who?: Who | string): Record<string, string> => (who ? { authorization: `Bearer ${who in tok ? tok[who as Who].access : who}` } : {}) as Record<string, string>;
  const call = async (h: Handler, path: string, who?: Who | string, extra?: unknown) => {
    const res = await h(new Request(`http://localhost/api/v1${path}`, { headers: bearer(who) }), extra);
    return { status: res.status, body: res.status === 204 ? null : await res.json() };
  };
  const member = (id: string) => ({ params: Promise.resolve({ memberId: id }) });
  const post = async (h: Handler, path: string, body: unknown, who?: Who | string) => {
    const res = await h(
      new Request(`http://localhost/api/v1${path}`, { method: "POST", headers: { "content-type": "application/json", ...bearer(who) }, body: JSON.stringify(body) }),
    );
    return { status: res.status, body: res.status === 204 ? null : await res.json() };
  };
  const upload = async (who: Who | undefined, csv: string, query = "", extraFields: Record<string, string> = {}) => {
    const form = new FormData();
    form.set("file", new File([csv], "members.csv", { type: "text/csv" }));
    for (const [k, v] of Object.entries(extraFields)) form.set(k, v);
    const res = await importMembers(new Request(`http://localhost/api/v1/members/import${query}`, { method: "POST", headers: bearer(who), body: form }));
    return { status: res.status, body: await res.json() };
  };

  it("bad credentials are 401 on every authenticated endpoint, in the contract error shape", async (ctx) => {
    if (!prisma) return ctx.skip();
    const expired = `expired-${sfx}`;
    await prisma.authSession.create({
      data: { tenantId: tenant.A.id, userId: uid.ownerA, accessHash: hashToken(expired), refreshHash: hashToken(`r-${expired}`), accessExpiresAt: new Date(Date.now() - 1000), refreshExpiresAt: new Date(Date.now() + 100000) },
    });
    const badTokens: (string | undefined)[] = [undefined, "garbage", expired, tok.ownerA.refresh];
    for (const who of badTokens) {
      const rs = await Promise.all([
        call(getMe, "/me", who),
        call(getTenant, "/tenant", who),
        call(listMembers, "/members", who),
        call(getMember, "/members/x", who, member(mem.kidA)),
        call(listBatches, "/batches", who),
        call(listSessions, "/sessions", who),
        post(signOut, "/auth/sign-out", {}, who),
        upload(who as Who | undefined, "name\nNobody Anon"),
      ]);
      for (const r of rs) {
        expect(r.status, String(who)).toBe(401);
        expect(validateSchemaName(r.body, "Error")).toEqual([]);
      }
      const put = await putTheme(new Request("http://localhost/api/v1/tenant/theme", { method: "PUT", headers: { "content-type": "application/json", ...bearer(who) }, body: "{}" }));
      expect(put.status, String(who)).toBe(401);
    }
    const basic = await getMe(new Request("http://localhost/api/v1/me", { headers: { authorization: `Basic ${tok.ownerA.access}` } }));
    expect(basic.status).toBe(401);
  });

  it("GET /tenant: every role gets its own tenant and a theme that differs per tenant", async (ctx) => {
    if (!prisma) return ctx.skip();
    const a = await call(getTenant, "/tenant", "ownerA");
    const b = await call(getTenant, "/tenant", "ownerB");
    expect(a.status).toBe(200);
    expect(validateSchemaName(a.body, "Tenant")).toEqual([]);
    expect(a.body).toMatchObject({ id: tenant.A.id, slug: tenant.A.slug });
    expect(b.body).toMatchObject({ id: tenant.B.id, slug: tenant.B.slug });
    expect(a.body.theme).toMatchObject({ displayName: "Iso A", primaryColor: "#7A1D1D", secondaryColor: "#222222", accentColor: "#FFC107", logoUrl: "https://example.test/a.png", defaultLocale: "en" });
    expect(b.body.theme).toMatchObject({ displayName: "Iso B", primaryColor: "#0B5D3B", secondaryColor: "#111827", accentColor: null, logoUrl: null, defaultLocale: "hi" });
    for (const k of ["primaryColor", "secondaryColor", "accentColor", "logoUrl", "displayName", "defaultLocale"] as const) {
      expect(a.body.theme[k], k).not.toEqual(b.body.theme[k]);
    }
    for (const who of ["coachA", "parentA", "adultA"] as const) expect((await call(getTenant, "/tenant", who)).body.id).toBe(tenant.A.id);
    for (const who of ["coachB", "customerB"] as const) expect((await call(getTenant, "/tenant", who)).body.id).toBe(tenant.B.id);
  });

  it("GET /tenants/{slug}/theme is public, differs per tenant and exposes no private fields", async (ctx) => {
    if (!prisma) return ctx.skip();
    const get = async (slug: string) => {
      const r = await getPublicTheme(new Request("http://localhost/x"), { params: Promise.resolve({ tenantSlug: slug }) });
      return { status: r.status, body: await r.json() };
    };
    const a = await get(tenant.A.slug);
    const b = await get(tenant.B.slug);
    expect(a.status).toBe(200);
    expect(a.body.primaryColor).not.toBe(b.body.primaryColor);
    expect(a.body.displayName).toBe("Iso A");
    expect(b.body.displayName).toBe("Iso B");
    expect(JSON.stringify(a.body)).not.toContain(tenant.B.id);
    expect(JSON.stringify(a.body)).not.toMatch(/email|userId|tenantId/);
  });

  it("GET /me: returns the caller only, scoped to their tenant and role", async (ctx) => {
    if (!prisma) return ctx.skip();
    const expectations: [Who, "A" | "B", string][] = [
      ["ownerA", "A", "owner"], ["coachA", "A", "coach"], ["parentA", "A", "customer"], ["ownerB", "B", "owner"], ["customerB", "B", "customer"],
    ];
    for (const [who, t, role] of expectations) {
      const r = await call(getMe, "/me", who);
      expect(r.status).toBe(200);
      expect(validateSchemaName(r.body, "Me")).toEqual([]);
      expect(r.body).toMatchObject({ id: uid[who], role, tenantId: tenant[t].id, tenantSlug: tenant[t].slug });
    }
    expect((await call(getMe, "/me", "parentA")).body.memberIds).toEqual([mem.kidA]);
    expect((await call(getMe, "/me", "customerB")).body.memberIds).toEqual([mem.memberB]);
    expect((await call(getMe, "/me", "coachA")).body.coachId).toBe(uid.coachA);
    // A client-supplied tenant hint is ignored.
    const spoof = await getMe(new Request("http://localhost/api/v1/me", { headers: { ...bearer("ownerA"), "x-tenant-id": tenant.B.id, "x-tenant-slug": tenant.B.slug } }));
    expect((await spoof.json()).tenantId).toBe(tenant.A.id);
  });

  it("GET /members: customers are 403 and the other tenant never leaks in", async (ctx) => {
    if (!prisma) return ctx.skip();
    for (const who of ["parentA", "adultA", "customerB"] as const) {
      const r = await call(listMembers, "/members", who);
      expect(r.status).toBe(403);
      expect(validateSchemaName(r.body, "Error")).toEqual([]);
    }
    const names = async (who: Who, q = "") => (await call(listMembers, `/members${q}`, who)).body.items.map((m: { name: string }) => m.name).sort();
    expect(await names("ownerA")).toEqual(["adultA", "kidA", "otherA"]);
    expect(await names("ownerB")).toEqual(["memberB"]);
    expect(await names("coachB")).toEqual(["memberB"]);
    // Filtering by another tenant's batch id yields nothing instead of that tenant's members.
    expect(await names("ownerA", `?batchId=${bat.B1}`)).toEqual([]);
    expect(await names("ownerB", `?batchId=${bat.A1}`)).toEqual([]);
  });

  it("GET /members/{id}: a member id from another tenant is 404 for every role", async (ctx) => {
    if (!prisma) return ctx.skip();
    for (const who of ["ownerB", "coachB", "customerB"] as const) {
      const r = await call(getMember, "/members/x", who, member(mem.kidA));
      expect(r.status, `${who} -> kidA`).toBe(404);
      expect(validateSchemaName(r.body, "Error")).toEqual([]);
    }
    for (const who of ["ownerA", "coachA", "parentA", "adultA"] as const) {
      expect((await call(getMember, "/members/x", who, member(mem.memberB))).status, `${who} -> memberB`).toBe(404);
    }
    expect((await call(getMember, "/members/x", "ownerA", member("does-not-exist"))).status).toBe(404);
    // Same-tenant role denials not covered elsewhere.
    expect((await call(getMember, "/members/x", "coachA2", member(mem.kidA))).status).toBe(403);
    expect((await call(getMember, "/members/x", "coachA", member(mem.otherA))).status).toBe(403);
    expect((await call(getMember, "/members/x", "parentA", member(mem.otherA))).status).toBe(403);
    expect((await call(getMember, "/members/x", "adultA", member(mem.otherA))).status).toBe(403);
  });

  it("GET /batches and /sessions: never include another tenant, even when filtered by its ids", async (ctx) => {
    if (!prisma) return ctx.skip();
    const batchIds = async (who: Who, q = "") => (await call(listBatches, `/batches${q}`, who)).body.items.map((b: { id: string }) => b.id).sort();
    expect(await batchIds("ownerA")).toEqual([bat.A1, bat.A2].sort());
    expect(await batchIds("ownerB")).toEqual([bat.B1]);
    expect(await batchIds("coachB")).toEqual([bat.B1]);
    expect(await batchIds("customerB")).toEqual([bat.B1]);
    expect(await batchIds("coachA2")).toEqual([bat.A2]);
    expect(await batchIds("ownerA", `?venueId=${ven.B}`)).toEqual([]);
    expect(await batchIds("ownerB", `?venueId=${ven.A}`)).toEqual([]);

    const sessionBatches = async (who: Who, q = "") => (await call(listSessions, `/sessions${q}`, who)).body.items.map((s: { batchId: string }) => s.batchId).sort();
    expect(await sessionBatches("ownerA")).toEqual([bat.A1, bat.A2].sort());
    expect(await sessionBatches("ownerB")).toEqual([bat.B1]);
    expect(await sessionBatches("customerB")).toEqual([bat.B1]);
    expect(await sessionBatches("ownerA", `?batchId=${bat.B1}`)).toEqual([]);
    expect(await sessionBatches("ownerB", `?batchId=${bat.A1}`)).toEqual([]);
    expect(await sessionBatches("ownerA", `?coachId=${uid.coachB}`)).toEqual([]);
    expect(await sessionBatches("coachA", `?batchId=${bat.A2}`)).toEqual([]);
    expect(await sessionBatches("parentA")).toEqual([bat.A1]);
  });

  it("POST /members/import: owner only; the tenant comes from the session, never from the request", async (ctx) => {
    if (!prisma) return ctx.skip();
    const csv = "name,phone\nIso Import Person,+919000000077";
    for (const who of ["coachA", "parentA", "coachB", "customerB"] as const) {
      const r = await upload(who, csv, "?dryRun=false");
      expect(r.status, who).toBe(403);
      expect(validateSchemaName(r.body, "Error")).toEqual([]);
    }
    expect((await upload(undefined, csv, "?dryRun=false")).status).toBe(401);
    expect(await prisma.member.count({ where: { displayName: "Iso Import Person" } })).toBe(0);

    // Owner B names tenant A in the form and query string; the member still lands in B.
    const r = await upload("ownerB", csv, `?dryRun=false&tenantId=${tenant.A.id}`, { tenantId: tenant.A.id, tenantSlug: tenant.A.slug });
    expect(r.status).toBe(200);
    expect(validateSchemaName(r.body, "ImportResult")).toEqual([]);
    expect(r.body.importedRows).toBe(1);
    expect(await prisma.member.count({ where: { tenantId: tenant.B.id, displayName: "Iso Import Person" } })).toBe(1);
    expect(await prisma.member.count({ where: { tenantId: tenant.A.id, displayName: "Iso Import Person" } })).toBe(0);
    expect((await call(listMembers, "/members?q=Iso Import", "ownerA")).body.items).toHaveLength(0);
    expect((await upload("ownerB", csv, "?dryRun=false")).body).toMatchObject({ importedRows: 0, skippedRows: 1 });
    expect((await upload("ownerA", csv, "?dryRun=false")).body.importedRows).toBe(1);
    expect(await prisma.member.count({ where: { displayName: "Iso Import Person" } })).toBe(2);
  });

  it("PUT /tenant/theme: an owner only ever changes their own tenant", async (ctx) => {
    if (!prisma) return ctx.skip();
    const before = await call(getTenant, "/tenant", "ownerA");
    const body = { displayName: "Iso B renamed", primaryColor: "#123456", secondaryColor: "#654321", accentColor: "#ABCDEF", logoUrl: null, defaultLocale: "kn" };
    const res = await putTheme(new Request("http://localhost/api/v1/tenant/theme", { method: "PUT", headers: { "content-type": "application/json", ...bearer("ownerB") }, body: JSON.stringify({ ...body, tenantSlug: tenant.A.slug, tenantId: tenant.A.id }) }));
    expect(res.status).toBe(200);
    const after = await call(getTenant, "/tenant", "ownerA");
    expect(after.body.theme).toEqual(before.body.theme);
    expect((await call(getTenant, "/tenant", "ownerB")).body.theme).toMatchObject({ primaryColor: "#123456", defaultLocale: "kn" });
  });

  it("POST /auth/sign-out revokes only the caller's own session, not another tenant's", async (ctx) => {
    if (!prisma) return ctx.skip();
    expect((await post(signOut, "/auth/sign-out", {}, "coachB")).status).toBe(204);
    expect((await call(getMe, "/me", "coachB")).status).toBe(401);
    expect((await call(getMe, "/me", "ownerB")).status).toBe(200);
    expect((await call(getMe, "/me", "ownerA")).status).toBe(200);
    expect((await post(signOut, "/auth/sign-out", {}, "coachB")).status).toBe(401);
  });

  it("POST /auth/refresh keeps the tenant and role; unusable tokens are 401", async (ctx) => {
    if (!prisma) return ctx.skip();
    const r = await post(refresh, "/auth/refresh", { refreshToken: tok.customerB.refresh });
    expect(r.status).toBe(200);
    expect(validateSchemaName(r.body, "Tokens")).toEqual([]);
    const me = await call(getMe, "/me", r.body.accessToken);
    expect(me.body).toMatchObject({ role: "customer", tenantId: tenant.B.id });
    expect((await post(refresh, "/auth/refresh", { refreshToken: tok.customerB.refresh })).status).toBe(401);
    expect((await post(refresh, "/auth/refresh", { refreshToken: tok.ownerA.access })).status).toBe(401);
    expect((await post(refresh, "/auth/refresh", { refreshToken: "nope" })).status).toBe(401);
    expect((await post(refresh, "/auth/refresh", {})).status).toBe(400);
  });

  it("POST /auth/magic-link/exchange yields a session for the link's own tenant and role only", async (ctx) => {
    if (!prisma) return ctx.skip();
    const link = await createMagicLink(uid.coachA, tenant.A.id);
    const r = await post(exchange, "/auth/magic-link/exchange", { token: link.token });
    expect(r.status).toBe(200);
    expect(r.body.user).toMatchObject({ role: "coach", tenantId: tenant.A.id });
    expect((await call(listMembers, "/members", r.body.accessToken)).body.items).toHaveLength(2); // coach A1's batch only
    expect((await post(exchange, "/auth/magic-link/exchange", { token: link.token })).status).toBe(401);
    expect((await post(exchange, "/auth/magic-link/exchange", { token: "x" })).status).toBe(401);
    expect((await post(exchange, "/auth/magic-link/exchange", {})).status).toBe(400);
    await expect(createMagicLink(uid.ownerB, tenant.A.id)).rejects.toMatchObject({ code: "not_found" });
  });

  it("DEV POST /dev/magic-link (not in the contract) cannot cross tenants and is off in production", async (ctx) => {
    if (!prisma) return ctx.skip();
    const ok = await post(devMagicLink, "/dev/magic-link", { tenantSlug: tenant.A.slug, email: "ownerA@A.example.test" });
    expect(ok.status).toBe(200);
    expect((await post(devMagicLink, "/dev/magic-link", { tenantSlug: tenant.A.slug, email: "ownerB@B.example.test" })).status).toBe(404);
    expect((await post(devMagicLink, "/dev/magic-link", { tenantSlug: "nope", email: "x@y.test" })).status).toBe(404);
    const prev = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = "production";
    try {
      expect((await post(devMagicLink, "/dev/magic-link", { tenantSlug: tenant.A.slug, email: "ownerA@A.example.test" })).status).toBe(404);
    } finally {
      (process.env as Record<string, string>).NODE_ENV = prev ?? "test";
    }
  });
});
