import type { Prisma } from "@prisma/client";
import { batchWhere } from "../auth/access";
import type { Principal } from "../auth/principal";
import type { TenantClient } from "../tenant-scope";
import { pageArgs, toPage } from "./pagination";

export type BatchDto = {
  id: string;
  name: string;
  sportId: string;
  sportName: string;
  venueId: string;
  venueName: string;
  coachIds: string[];
  isGroupClass: boolean;
  capacity: number | null;
  memberCount: number;
  schedule: { weekday: number; startTime: string; endTime: string }[];
};

/** GET /batches (listBatches). */
export async function listBatches(db: TenantClient, p: Principal, params: URLSearchParams) {
  const { limit, args } = pageArgs(params);
  const and: Prisma.BatchWhereInput[] = [batchWhere(p), { isActive: true }];
  const venueId = params.get("venueId");
  const sportId = params.get("sportId");
  if (venueId) and.push({ venueId });
  if (sportId) and.push({ sportId });

  const rows = await db.batch.findMany({
    where: { AND: and },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    include: {
      sport: { select: { name: true } },
      venue: { select: { name: true } },
      _count: { select: { enrollments: { where: { leftOn: null } } } },
    },
    ...args,
  });
  const page = toPage(rows, limit);
  const items: BatchDto[] = page.rows.map((b) => ({
    id: b.id,
    name: b.name,
    sportId: b.sportId,
    sportName: b.sport.name,
    venueId: b.venueId,
    venueName: b.venue.name,
    coachIds: [b.coachId],
    isGroupClass: b.kind === "GROUP_CLASS",
    capacity: b.capacity,
    memberCount: b._count.enrollments,
    schedule: [...b.daysOfWeek]
      .sort((a, c) => a - c)
      .map((weekday) => ({ weekday, startTime: b.startTime, endTime: b.endTime })),
  }));
  return { items, nextCursor: page.nextCursor };
}
