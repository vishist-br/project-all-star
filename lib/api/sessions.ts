import type { Prisma } from "@prisma/client";
import { memberWhere, sessionWhere } from "../auth/access";
import type { Principal } from "../auth/principal";
import type { TenantClient } from "../tenant-scope";
import { dateParam, enumParam, pageArgs, toPage } from "./pagination";

export type SessionDto = {
  id: string;
  batchId: string;
  batchName: string;
  coachId: string;
  coachName: string;
  venueId: string;
  startsAt: string;
  endsAt: string;
  status: "scheduled" | "completed" | "cancelled";
  attendanceSummary: { present: number; absent: number; excused: number; total: number } | null;
  coachNote: string | null;
  kind: "group_class" | "one_on_one";
  capacity: number | null;
  bookedCount: number;
  waitlistCount: number;
  /** Customers only: status of the caller's (or child's) booking, null when none. */
  myBookingStatus?: "booked" | "waitlisted" | "cancelled" | null;
};

const STATUSES = ["scheduled", "completed", "cancelled"] as const;

/** GET /sessions (listSessions). Newest first. */
export async function listSessions(db: TenantClient, p: Principal, params: URLSearchParams) {
  const { limit, args } = pageArgs(params);
  const and: Prisma.SessionWhereInput[] = [sessionWhere(p)];
  const from = dateParam(params, "from");
  const to = dateParam(params, "to");
  if (from) and.push({ startsAt: { gte: from } });
  // `to` is an inclusive calendar date.
  if (to) and.push({ startsAt: { lt: new Date(to.getTime() + 86_400_000) } });
  const batchId = params.get("batchId");
  if (batchId) and.push({ batchId });
  const coachId = params.get("coachId");
  // For the coach role the own-sessions filter is already forced; coachId is ignored.
  if (coachId && p.role !== "coach") and.push({ coachId });
  const status = enumParam(params, "status", STATUSES);
  if (status) and.push({ status: status.toUpperCase() as "SCHEDULED" | "COMPLETED" | "CANCELLED" });

  const rows = await db.session.findMany({
    where: { AND: and },
    orderBy: [{ startsAt: "desc" }, { id: "asc" }],
    include: {
      batch: { select: { name: true, venueId: true, kind: true, capacity: true } },
      coach: { select: { name: true } },
    },
    ...args,
  });
  const page = toPage(rows, limit);

  // Three independent reads keyed by the page's session ids: run them together, not one after another.
  const ids = page.rows.map((s) => s.id);
  type MyRow = { sessionId: string; status: string };
  const [grouped, counts, myRows] = ids.length
    ? await Promise.all([
        db.attendance.groupBy({ by: ["sessionId", "status"], where: { sessionId: { in: ids } }, _count: { _all: true } }),
        db.sessionBooking.groupBy({
          by: ["sessionId", "status"],
          where: { sessionId: { in: ids }, status: { in: ["BOOKED", "WAITLISTED"] } },
          _count: { _all: true },
        }),
        p.role === "customer"
          ? db.sessionBooking.findMany({ where: { sessionId: { in: ids }, member: memberWhere(p) }, select: { sessionId: true, status: true } })
          : Promise.resolve([] as MyRow[]),
      ])
    : [[], [], [] as MyRow[]];
  const summary = new Map<string, { present: number; absent: number; excused: number; total: number }>();
  for (const g of grouped) {
    const s = summary.get(g.sessionId) ?? { present: 0, absent: 0, excused: 0, total: 0 };
    const n = g._count._all;
    if (g.status === "PRESENT") s.present += n;
    else if (g.status === "ABSENT") s.absent += n;
    else s.excused += n;
    s.total += n;
    summary.set(g.sessionId, s);
  }

  const booked = new Map<string, number>();
  const waiting = new Map<string, number>();
  for (const c of counts) (c.status === "BOOKED" ? booked : waiting).set(c.sessionId, c._count._all);
  const mine = new Map<string, "booked" | "waitlisted" | "cancelled">();
  const rank = { booked: 0, waitlisted: 1, cancelled: 2 } as const;
  for (const r of myRows) {
    const st = r.status.toLowerCase() as keyof typeof rank;
    const cur = mine.get(r.sessionId);
    if (!cur || rank[st] < rank[cur]) mine.set(r.sessionId, st);
  }

  const items: SessionDto[] = page.rows.map((s) => ({
    id: s.id,
    batchId: s.batchId,
    batchName: s.batch.name,
    coachId: s.coachId,
    coachName: s.coach.name,
    venueId: s.batch.venueId,
    startsAt: s.startsAt.toISOString(),
    endsAt: s.endsAt.toISOString(),
    status: s.status.toLowerCase() as SessionDto["status"],
    attendanceSummary: summary.get(s.id) ?? null,
    coachNote: s.coachNote,
    kind: s.batch.kind === "ONE_ON_ONE" ? "one_on_one" : "group_class",
    capacity: s.capacity ?? s.batch.capacity,
    bookedCount: booked.get(s.id) ?? 0,
    waitlistCount: waiting.get(s.id) ?? 0,
    ...(p.role === "customer" ? { myBookingStatus: mine.get(s.id) ?? null } : {}),
  }));
  return { items, nextCursor: page.nextCursor };
}
