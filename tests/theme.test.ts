import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { contrastRatio, contrastWarnings, getThemeBySlug, parseThemeInput, updateTheme } from "../lib/theme";
import { tryConnect } from "./helpers-db";
import { PUT } from "../app/api/v1/tenant/theme/route";
import { GET as getTenant } from "../app/api/v1/tenant/route";
import { GET as getPublicTheme } from "../app/api/v1/tenants/[tenantSlug]/theme/route";
import { createMagicLink, exchangeMagicLink } from "../lib/auth/magic-link";

const valid = { displayName: "Fake Karate", primaryColor: "#7a1d1d", secondaryColor: "#0b1f3a", accentColor: "#f2a900" };

describe("theme validation (no database)", () => {
  it("accepts valid input and normalizes hex to upper case", () => {
    expect(parseThemeInput(valid)).toMatchObject({ primaryColor: "#7A1D1D", logoUrl: null });
  });
  it("rejects bad hex, name, logo and locale, listing each field", () => {
    try {
      parseThemeInput({ displayName: "", primaryColor: "red", secondaryColor: "#12345", accentColor: "#GGGGGG", logoUrl: "javascript:alert(1)", defaultLocale: "fr" });
      throw new Error("should have thrown");
    } catch (e) {
      const fields = (e as { details: { field: string }[] }).details.map((d) => d.field).sort();
      expect(fields).toEqual(["accentColor", "defaultLocale", "displayName", "logoUrl", "primaryColor", "secondaryColor"]);
    }
  });
  it("warns about low contrast with white text", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 0);
    expect(contrastWarnings({ primaryColor: "#FFFF00", secondaryColor: "#0B1F3A" }).map((w) => w.field)).toEqual(["primaryColor"]);
    expect(contrastWarnings({ primaryColor: "#7A1D1D", secondaryColor: "#0B1F3A" })).toEqual([]);
  });
});

describe("theme API (local Postgres)", () => {
  let prisma: PrismaClient | null = null;
  const sfx = Date.now().toString(36);
  const t: Record<string, { id: string; slug: string }> = {};
  const tok: Record<string, string> = {};

  const put = (token: string | null, body: unknown) =>
    PUT(
      new Request("http://x/api/v1/tenant/theme", {
        method: "PUT",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      }),
    );

  beforeAll(async () => {
    prisma = await tryConnect();
    if (!prisma) return;
    for (const k of ["a", "b"]) {
      const slug = `th-${k}-${sfx}`;
      t[k] = { id: (await prisma.tenant.create({ data: { slug, name: `Tenant ${k}` } })).id, slug };
      for (const [role, r] of [["owner", "OWNER"], ["coach", "COACH"], ["customer", "CUSTOMER"]] as const) {
        const u = await prisma.user.create({ data: { tenantId: t[k].id, role: r, email: `${role}@${k}.test`, name: role } });
        tok[`${k}-${role}`] = (await exchangeMagicLink((await createMagicLink(u.id, t[k].id)).token)).accessToken;
      }
    }
  });

  afterAll(async () => {
    if (!prisma) return;
    for (const k of Object.keys(t)) {
      await prisma.magicLink.deleteMany({ where: { tenantId: t[k].id } });
      await prisma.authSession.deleteMany({ where: { tenantId: t[k].id } });
      await prisma.tenantTheme.deleteMany({ where: { tenantId: t[k].id } });
    }
    await prisma.tenant.deleteMany({ where: { id: { in: Object.values(t).map((x) => x.id) } } });
    await prisma.$disconnect();
  });

  it("returns defaults when a tenant has no theme yet", async (ctx) => {
    if (!prisma) return ctx.skip();
    const theme = await getThemeBySlug(prisma, t.a.slug);
    expect(theme).toMatchObject({ tenantSlug: t.a.slug, displayName: "Tenant a", logoUrl: null });
  });

  it("owner updates; two tenants return different themes", async (ctx) => {
    if (!prisma) return ctx.skip();
    const ra = await put(tok["a-owner"], { ...valid, displayName: "Fake Karate A", logoUrl: "https://cdn.example.test/a.png" });
    expect(ra.status).toBe(200);
    expect((await ra.json()).warnings).toEqual([]);
    const rb = await put(tok["b-owner"], { displayName: "Fake Gym B", primaryColor: "#FFFF00", secondaryColor: "#111111" });
    expect(rb.status).toBe(200);
    expect((await rb.json()).warnings).toHaveLength(1);

    const pa = await (await getPublicTheme(new Request("http://x"), { params: Promise.resolve({ tenantSlug: t.a.slug }) })).json();
    const pb = await (await getPublicTheme(new Request("http://x"), { params: Promise.resolve({ tenantSlug: t.b.slug }) })).json();
    expect(pa).toMatchObject({ displayName: "Fake Karate A", primaryColor: "#7A1D1D", logoUrl: "https://cdn.example.test/a.png" });
    expect(pb).toMatchObject({ displayName: "Fake Gym B", primaryColor: "#FFFF00", logoUrl: null });
    expect(pa.primaryColor).not.toBe(pb.primaryColor);
  });

  it("an owner can only change their own tenant", async (ctx) => {
    if (!prisma) return ctx.skip();
    await put(tok["a-owner"], { ...valid, displayName: "Only A changed" });
    expect((await getThemeBySlug(prisma, t.b.slug)).displayName).toBe("Fake Gym B");
  });

  it("coach and customer are denied (403), anonymous gets 401", async (ctx) => {
    if (!prisma) return ctx.skip();
    expect((await put(tok["a-coach"], valid)).status).toBe(403);
    expect((await put(tok["a-customer"], valid)).status).toBe(403);
    expect((await put(null, valid)).status).toBe(401);
    expect((await getThemeBySlug(prisma, t.a.slug)).displayName).toBe("Only A changed");
  });

  it("invalid input returns 400 with details; nothing is saved", async (ctx) => {
    if (!prisma) return ctx.skip();
    const r = await put(tok["a-owner"], { ...valid, primaryColor: "blue" });
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.details[0].field).toBe("primaryColor");
    expect((await getThemeBySlug(prisma, t.a.slug)).primaryColor).toBe("#7A1D1D");
  });

  it("unknown slug is 404; every role can read /tenant", async (ctx) => {
    if (!prisma) return ctx.skip();
    const r = await getPublicTheme(new Request("http://x"), { params: Promise.resolve({ tenantSlug: "nope-" + sfx }) });
    expect(r.status).toBe(404);
    for (const role of ["owner", "coach", "customer"]) {
      const res = await getTenant(new Request("http://x", { headers: { authorization: `Bearer ${tok[`a-${role}`]}` } }));
      expect(res.status).toBe(200);
      expect((await res.json()).slug).toBe(t.a.slug);
    }
  });

  it("updateTheme persists locale", async (ctx) => {
    if (!prisma) return ctx.skip();
    const res = await updateTheme(prisma, t.a.id, parseThemeInput({ ...valid, defaultLocale: "kn" }));
    expect(res.defaultLocale).toBe("kn");
  });
});
