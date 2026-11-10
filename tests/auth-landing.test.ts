import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import { createMagicLink } from "../lib/auth/magic-link";
import { resolvePrincipal } from "../lib/auth/session";
import { ACCESS_COOKIE, REFRESH_COOKIE, authCookieOptions } from "../lib/auth-cookies";
import { POST as sessionPost } from "../app/auth/session/route";
import { POST as signOutPost } from "../app/auth/sign-out/route";
import { tryConnect } from "./helpers-db";

describe("auth cookie options", () => {
  it("are httpOnly, SameSite=Lax, path /, and Secure in production", () => {
    const o = authCookieOptions(60);
    expect(o).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 });
    const prev = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = "production";
    expect(authCookieOptions(60).secure).toBe(true);
    (process.env as Record<string, string>).NODE_ENV = prev ?? "test";
  });
});

describe("/auth/session and /auth/sign-out (local Postgres)", () => {
  let prisma: PrismaClient | null = null;
  const sfx = Date.now().toString(36);
  let tenantId = "";
  let userId = "";

  beforeAll(async () => {
    prisma = await tryConnect();
    if (!prisma) return;
    tenantId = (await prisma.tenant.create({ data: { slug: `al-${sfx}`, name: "AL" } })).id;
    userId = (await prisma.user.create({ data: { tenantId, role: "COACH", email: "c@al.test", name: "c" } })).id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.magicLink.deleteMany({ where: { tenantId } });
    await prisma.authSession.deleteMany({ where: { tenantId } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await prisma.$disconnect();
  });

  const post = (token: unknown) =>
    sessionPost(new Request("http://x/auth/session", { method: "POST", body: JSON.stringify({ token }) }));

  it("exchanges a link, sets httpOnly cookies, returns no tokens in the body; sign-out revokes", async (ctx) => {
    if (!prisma) return ctx.skip();
    const link = await createMagicLink(userId, tenantId);
    const res = await post(link.token);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ role: "coach", tenantSlug: `al-${sfx}` });
    const setCookie = res.headers.getSetCookie();
    expect(setCookie).toHaveLength(2);
    for (const c of setCookie) {
      expect(c).toMatch(/HttpOnly/i);
      expect(c).toMatch(/SameSite=lax/i);
      expect(c).toMatch(/Path=\//);
    }
    const access = setCookie.find((c) => c.startsWith(`${ACCESS_COOKIE}=`))!.split(";")[0].split("=")[1];
    expect(JSON.stringify(body)).not.toContain(access);
    expect(await resolvePrincipal(new Request("http://x", { headers: { authorization: `Bearer ${access}` } }))).toMatchObject({ userId, role: "coach" });

    // Single use: the same link now fails with a friendly-mappable 401.
    const again = await post(link.token);
    expect(again.status).toBe(401);
    expect(again.headers.getSetCookie()).toHaveLength(0);

    const out = await signOutPost(new NextRequest("http://x/auth/sign-out", { method: "POST", headers: { cookie: `${ACCESS_COOKIE}=${access}` } }));
    expect(out.status).toBe(303);
    expect(out.headers.get("location")).toBe("/sign-in");
    const cleared = out.headers.getSetCookie().join("\n");
    expect(cleared).toContain(`${ACCESS_COOKIE}=;`);
    expect(cleared).toContain(`${REFRESH_COOKIE}=;`);
    expect(await resolvePrincipal(new Request("http://x", { headers: { authorization: `Bearer ${access}` } }))).toBeNull();
  });

  it("rejects missing and bogus tokens", async (ctx) => {
    if (!prisma) return ctx.skip();
    expect((await post(undefined)).status).toBe(400);
    expect((await post("nope")).status).toBe(401);
  });
});
