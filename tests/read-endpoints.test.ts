import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { hashToken } from "../lib/auth/tokens";
import { seedDemo } from "../prisma/seed/demo";
import { TENANTS } from "../prisma/seed/data";
import { tryConnect } from "./helpers-db";
import { validateSchemaName } from "./contract-schema";
import { GET as listMembers } from "../app/api/v1/members/route";
import { GET as getMember } from "../app/api/v1/members/[memberId]/route";
import { GET as listBatches } from "../app/api/v1/batches/route";
import { GET as listSessions } from "../app/api/v1/sessions/route";

describe("contract validator sanity", () => {
  it("rejects unknown fields, missing required fields and bad enums", () => {
    expect(validateSchemaName({ items: [], nextCursor: null }, "SessionPage")).toEqual([]);
    expect(validateSchemaName({ items: [], extra: 1 }, "SessionPage")).not.toEqual([]);
    expect(validateSchemaName({}, "SessionPage")).not.toEqual([]);
    expect(validateSchemaName({ items: [{ id: "x", name: "n", status: "nope" }] }, "MemberPage")).not.toEqual([]);
  });
});

describe("read endpoints (local Postgres, seeded demo data)", () => {
  let prisma: PrismaClient | null = null;
  const tokens: Record<string, string> = {};
  const tenantIds: Record<string, string> = {};
  const sessionIds: string[] = [];

  beforeAll(async () => {
    prisma = await tryConnect();
    if (!prisma) return;
    const ids = await seedDemo(prisma);
    TENANTS.forEach((t, i) => (tenantIds[t.slug] = ids[i]));
    const login = async (label: string, slug: string, emailKey: string) => {
      const user = await prisma!.user.findFirstOrThrow({
        where: { tenantId: tenantIds[slug], email: `${emailKey}@${slug}.example.test` },
      });
      const token = `test-${label}-${Math.random().toString(36).slice(2)}-${Date.now()}`;
      const s = await prisma!.authSession.create({
        data: {
          tenantId: user.tenantId,
          userId: user.id,
          accessHash: hashToken(token),
          refreshHash: hashToken(`r-${token}`),
          accessExpiresAt: new Date(Date.now() + 3_600_000),
          refreshExpiresAt: new Date(Date.now() + 7_200_000),
        },
      });
      sessionIds.push(s.id);
      tokens[label] = token;
    };
    await login("owner", "demo-karate", "owner");
    await login("coach1", "demo-karate", "c1");
    await login("coach2", "demo-karate", "c2");
    await login("parent", "demo-karate", "parent-g1");
    await login("adult", "demo-karate", "member-a1");
    await login("gymOwner", "demo-gym", "owner");
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.authSession.deleteMany({ where: { id: { in: sessionIds } } });
      await prisma.$disconnect();
    }
  });

  const req = (path: string, who?: string) =>
    new Request(`http://localhost/api/v1${path}`, { headers: who ? { authorization: `Bearer ${tokens[who]}` } : {} });
  const call = async (
    handler: (...args: any[]) => Promise<Response>, // eslint-disable-line @typescript-eslint/no-explicit-any
    path: string,
    who?: string,
    memberId?: string,
  ) => {
    const res = await handler(req(path, who), memberId ? { params: Promise.resolve({ memberId }) } : undefined);
    return { status: res.status, body: (await res.json()) as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };

  it("requires a valid session", async (ctx) => {
    if (!prisma) return ctx.skip();
    for (const [h, p] of [[listMembers, "/members"], [listBatches, "/batches"], [listSessions, "/sessions"]] as const) {
      const r = await call(h, p);
      expect(r.status).toBe(401);
      expect(validateSchemaName(r.body, "Error")).toEqual([]);
    }
  });

  it("GET /members: owner sees every seeded member in contract shape", async (ctx) => {
    if (!prisma) return ctx.skip();
    const r = await call(listMembers, "/members", "owner");
    expect(r.status).toBe(200);
    expect(validateSchemaName(r.body, "MemberPage")).toEqual([]);
    expect(r.body.items).toHaveLength(8);
    expect(r.body.nextCursor).toBeNull();
    const kid3 = r.body.items.find((m: { name: string }) => m.name === "Sample Kid 03");
    expect(kid3).toMatchObject({ status: "active", level: "Yellow", feeStatus: "due" });
    expect(kid3.batchIds).toHaveLength(1);
    expect(typeof kid3.attendancePercent).toBe("number");
    // WAIVED has no contract value, so feeStatus is omitted for Kid 06.
    const kid6 = r.body.items.find((m: { name: string }) => m.name === "Sample Kid 06");
    expect("feeStatus" in kid6).toBe(false);
  });

  it("GET /members: cursor pagination walks every page without repeats", async (ctx) => {
    if (!prisma) return ctx.skip();
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const r: { status: number; body: any } = await call(listMembers, `/members?limit=3${cursor ? `&cursor=${cursor}` : ""}`, "owner"); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(r.status).toBe(200);
      expect(validateSchemaName(r.body, "MemberPage")).toEqual([]);
      expect(r.body.items.length).toBeLessThanOrEqual(3);
      seen.push(...r.body.items.map((m: { id: string }) => m.id));
      cursor = r.body.nextCursor;
      pages++;
    } while (cursor);
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(8);
  });

  it("validates limit and cursor", async (ctx) => {
    if (!prisma) return ctx.skip();
    for (const q of ["limit=0", "limit=101", "limit=abc", "cursor=%25%25"]) {
      const r = await call(listMembers, `/members?${q}`, "owner");
      expect(r.status, q).toBe(400);
      expect(r.body.error.code).toBe("validation_failed");
    }
    expect((await call(listSessions, "/sessions?status=bogus", "owner")).status).toBe(400);
    expect((await call(listSessions, "/sessions?from=2026-13-99x", "owner")).status).toBe(400);
  });

  it("GET /members filters: q, batchId, status", async (ctx) => {
    if (!prisma) return ctx.skip();
    const q = await call(listMembers, "/members?q=adult", "owner");
    expect(q.body.items.map((m: { name: string }) => m.name)).toEqual(["Sample Adult 01", "Sample Adult 02"]);
    const batches = await call(listBatches, "/batches", "owner");
    const kids = batches.body.items.find((b: { name: string }) => b.name.startsWith("Kids"));
    const inBatch = await call(listMembers, `/members?batchId=${kids.id}`, "owner");
    expect(inBatch.body.items).toHaveLength(6);
    expect((await call(listMembers, "/members?status=ended", "owner")).body.items).toHaveLength(0);
    expect((await call(listMembers, "/members?status=active", "owner")).body.items).toHaveLength(8);
  });

  it("GET /members: coach sees only own batches; customer is forbidden", async (ctx) => {
    if (!prisma) return ctx.skip();
    const c1 = await call(listMembers, "/members", "coach1");
    expect(c1.body.items).toHaveLength(6);
    const c2 = await call(listMembers, "/members", "coach2");
    expect(c2.body.items.map((m: { name: string }) => m.name)).toEqual(["Sample Adult 01", "Sample Adult 02"]);
    for (const who of ["parent", "adult"]) {
      const r = await call(listMembers, "/members", who);
      expect(r.status).toBe(403);
      expect(validateSchemaName(r.body, "Error")).toEqual([]);
    }
  });

  it("GET /members/{id}: detail shape, own-view rules and tenant isolation", async (ctx) => {
    if (!prisma) return ctx.skip();
    const all = (await call(listMembers, "/members", "owner")).body.items as { id: string; name: string }[];
    const kid1 = all.find((m) => m.name === "Sample Kid 01")!;
    const kid2 = all.find((m) => m.name === "Sample Kid 02")!;
    const adult1 = all.find((m) => m.name === "Sample Adult 01")!;

    const owner = await call(getMember, "/members/x", "owner", kid1.id);
    expect(owner.status).toBe(200);
    expect(validateSchemaName(owner.body, "MemberDetail")).toEqual([]);
    expect(owner.body.guardianName).toBe("Sample Parent 01");
    expect(owner.body.joinDate).toBe("2026-01-05");
    const a = owner.body.attendance;
    expect(a.attended + a.missed + a.excused).toBe(owner.body.recentSessions.length);
    expect(a.scheduled).toBeGreaterThanOrEqual(a.attended + a.missed + a.excused);
    expect(owner.body.progressPercent).toBeGreaterThanOrEqual(0);

    // Parent: own child only.
    expect((await call(getMember, "/members/x", "parent", kid1.id)).status).toBe(200);
    expect((await call(getMember, "/members/x", "parent", kid2.id)).status).toBe(403);
    // Adult member: self only.
    expect((await call(getMember, "/members/x", "adult", adult1.id)).status).toBe(200);
    expect((await call(getMember, "/members/x", "adult", kid1.id)).status).toBe(403);
    // Coach: own batch yes, other coach's batch no.
    expect((await call(getMember, "/members/x", "coach1", kid1.id)).status).toBe(200);
    expect((await call(getMember, "/members/x", "coach1", adult1.id)).status).toBe(403);
    // Another tenant: 404, and its list never shows our members.
    const cross = await call(getMember, "/members/x", "gymOwner", kid1.id);
    expect(cross.status).toBe(404);
    expect(validateSchemaName(cross.body, "Error")).toEqual([]);
    const gym = await call(listMembers, "/members", "gymOwner");
    expect(gym.body.items).toHaveLength(8);
    expect(gym.body.items.every((m: { name: string }) => m.name.startsWith("Sample Member"))).toBe(true);
  });

  it("GET /batches: contract shape, role views, filters, tenant isolation", async (ctx) => {
    if (!prisma) return ctx.skip();
    const owner = await call(listBatches, "/batches", "owner");
    expect(owner.status).toBe(200);
    expect(validateSchemaName(owner.body, "BatchPage")).toEqual([]);
    expect(owner.body.items).toHaveLength(2);
    const kids = owner.body.items.find((b: { name: string }) => b.name.startsWith("Kids"));
    expect(kids).toMatchObject({
      sportName: "Karate",
      isGroupClass: true,
      capacity: 20,
      memberCount: 6,
      schedule: [
        { weekday: 1, startTime: "17:00", endTime: "18:00" },
        { weekday: 3, startTime: "17:00", endTime: "18:00" },
        { weekday: 5, startTime: "17:00", endTime: "18:00" },
      ],
    });
    expect(kids.venueName).toBe("Sample Dojo Main Hall");
    expect((await call(listBatches, "/batches", "coach1")).body.items.map((b: { id: string }) => b.id)).toEqual([kids.id]);
    expect((await call(listBatches, "/batches", "parent")).body.items.map((b: { id: string }) => b.id)).toEqual([kids.id]);
    expect((await call(listBatches, `/batches?venueId=${kids.venueId}`, "owner")).body.items).toHaveLength(2);
    expect((await call(listBatches, "/batches?venueId=nope", "owner")).body.items).toHaveLength(0);
    expect((await call(listBatches, `/batches?sportId=${kids.sportId}`, "owner")).body.items).toHaveLength(2);
    const gym = await call(listBatches, "/batches", "gymOwner");
    expect(gym.body.items).toHaveLength(3);
    expect(gym.body.items.some((b: { id: string }) => b.id === kids.id)).toBe(false);
    const p1 = await call(listBatches, "/batches?limit=1", "owner");
    expect(p1.body.items).toHaveLength(1);
    const p2 = await call(listBatches, `/batches?limit=1&cursor=${p1.body.nextCursor}`, "owner");
    expect(p2.body.items).toHaveLength(1);
    expect(p2.body.items[0].id).not.toBe(p1.body.items[0].id);
    expect(p2.body.nextCursor).toBeNull();
  });

  it("GET /sessions: contract shape, role views, filters, pagination", async (ctx) => {
    if (!prisma) return ctx.skip();
    const owner = await call(listSessions, "/sessions?limit=100", "owner");
    expect(owner.status).toBe(200);
    expect(validateSchemaName(owner.body, "SessionPage")).toEqual([]);
    expect(owner.body.items).toHaveLength(7);
    const starts = owner.body.items.map((s: { startsAt: string }) => s.startsAt);
    expect([...starts].sort().reverse()).toEqual(starts);
    const completed = owner.body.items.find((s: { status: string }) => s.status === "completed");
    expect(completed.attendanceSummary.total).toBeGreaterThan(0);
    const cancelled = owner.body.items.find((s: { status: string }) => s.status === "cancelled");
    expect(cancelled.attendanceSummary).toBeNull();

    expect((await call(listSessions, "/sessions?status=cancelled", "owner")).body.items).toHaveLength(1);
    expect((await call(listSessions, "/sessions?status=scheduled", "owner")).body.items).toHaveLength(0);
    // 2026-10-19 .. 2026-10-20 inclusive: kids Oct 19, adults Oct 20.
    const range = await call(listSessions, "/sessions?from=2026-10-19&to=2026-10-20", "owner");
    expect(range.body.items).toHaveLength(2);

    const c1 = await call(listSessions, "/sessions", "coach1");
    expect(c1.body.items).toHaveLength(4);
    // coachId is ignored for the coach role (forced to self).
    const forced = await call(listSessions, `/sessions?coachId=${owner.body.items.find((s: { coachName: string }) => s.coachName === "Sample Coach Beta").coachId}`, "coach1");
    expect(forced.body.items).toHaveLength(4);
    const byCoach = await call(listSessions, `/sessions?coachId=${c1.body.items[0].coachId}`, "owner");
    expect(byCoach.body.items).toHaveLength(4);

    expect((await call(listSessions, "/sessions", "parent")).body.items).toHaveLength(4);
    expect((await call(listSessions, "/sessions", "adult")).body.items).toHaveLength(3);
    expect((await call(listSessions, `/sessions?batchId=${c1.body.items[0].batchId}`, "coach2")).body.items).toHaveLength(0);
    expect((await call(listSessions, "/sessions", "gymOwner")).body.items).toHaveLength(9);

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const r: { body: any } = await call(listSessions, `/sessions?limit=3${cursor ? `&cursor=${cursor}` : ""}`, "owner"); // eslint-disable-line @typescript-eslint/no-explicit-any
      seen.push(...r.body.items.map((s: { id: string }) => s.id));
      cursor = r.body.nextCursor;
    } while (cursor);
    expect(seen).toEqual(owner.body.items.map((s: { id: string }) => s.id));
  });
});
