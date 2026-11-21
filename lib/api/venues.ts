import type { Prisma } from "@prisma/client";
import { batchWhere } from "../auth/access";
import type { Principal } from "../auth/principal";
import type { TenantClient } from "../tenant-scope";
import { pageArgs, toPage } from "./pagination";

export type VenueDto = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  timezone: string;
  batchCount: number;
};

/** GET /venues (listVenues). Owner: all active venues. Coach and customer: venues of batches they can see. */
export async function listVenues(db: TenantClient, p: Principal, params: URLSearchParams) {
  const { limit, args } = pageArgs(params);
  const and: Prisma.VenueWhereInput[] = [{ isActive: true }];
  if (p.role !== "owner") and.push({ batches: { some: { AND: [batchWhere(p), { isActive: true }] } } });

  const rows = await db.venue.findMany({
    where: { AND: and },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    include: { _count: { select: { batches: { where: { isActive: true } } } } },
    ...args,
  });
  const page = toPage(rows, limit);
  const items: VenueDto[] = page.rows.map((v) => ({
    id: v.id,
    name: v.name,
    address: v.address,
    city: v.city,
    timezone: v.timezone,
    batchCount: v._count.batches,
  }));
  return { items, nextCursor: page.nextCursor };
}
