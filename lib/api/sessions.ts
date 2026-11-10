import type { Prisma } from "@prisma/client";
import { sessionWhere } from "../auth/access";
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
      batch: { select: { name: true, venueId: true } },
      coach: { select: { name: true } },
    },
    ...args,
  });
  const page = toPage(rows, limit);

  const grouped = page.rows.length
    ? await db.attendance.groupBy({
        by: ["sessionId", "status"],
        where: { sessionId: { in: page.rows.map((s) => s.id) } },
        _count: { _all: true },
      })
    : [];
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
  }));
  return { items, nextCursor: page.nextCursor };
}
