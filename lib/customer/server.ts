import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { memberWhere } from "@/lib/auth/access";
import { checkRole } from "@/lib/auth/guard";
import type { OperationId } from "@/lib/auth/policy";
import { tenantDate } from "@/lib/api/pagination";
import { getViewer } from "@/lib/viewer";

/** Which child a parent is viewing. Chosen with the switcher (server action), checked against the family on every read. */
export const CHILD_COOKIE = "as_child";

export type ChildOption = { id: string; name: string; isOwn: boolean };

/**
 * The signed-in customer and the members whose data they may see (their own profile and/or their
 * children). Everything on the customer screens reads through this: the viewer principal, the
 * tenant-scoped client and the selected member. Other roles get a 404 here, so a coach or owner
 * never sees a customer screen.
 */
export async function getCustomerContext() {
  const viewer = await getViewer();
  if (viewer.principal.role !== "customer") notFound();
  const { principal, db } = viewer;
  const rows = await db.member.findMany({
    where: memberWhere(principal),
    select: { id: true, displayName: true, userId: true, isActive: true },
    orderBy: [{ displayName: "asc" }, { id: "asc" }],
  });
  const active = rows.filter((r) => r.isActive);
  const list = (active.length > 0 ? active : rows).map<ChildOption>((r) => ({
    id: r.id,
    name: r.displayName,
    isOwn: r.userId === principal.userId,
  }));
  const now = new Date();
  const wanted = (await cookies()).get(CHILD_COOKIE)?.value;
  const selected = list.find((c) => c.id === wanted) ?? list[0] ?? null;
  return { principal, db, userName: viewer.session.name, children: list, selected, now, today: tenantDate(now) };
}

/** Role check shared with the API routes (same operation ids as docs/api/openapi.yaml). */
export function allow(principal: Parameters<typeof checkRole>[0], operation: OperationId) {
  return checkRole(principal, operation);
}
