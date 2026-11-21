"use server";
import { cookies } from "next/headers";
import { ApiError } from "@/lib/auth/errors";
import { markMemberUpdatesRead } from "@/lib/api/member-updates";
import { CHILD_COOKIE, allow, getCustomerContext } from "@/lib/customer/server";

/** Remember which child the parent is viewing. Only members of the signed-in family are accepted. */
export async function selectChildAction(memberId: string): Promise<{ ok: boolean }> {
  const { children } = await getCustomerContext();
  if (!children.some((c) => c.id === memberId)) return { ok: false };
  (await cookies()).set(CHILD_COOKIE, memberId, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 90 });
  return { ok: true };
}

/** Marks the member's updates up to `upTo` (the newest createdAt shown) as read. */
export async function markUpdatesReadAction(memberId: string, upTo: string): Promise<{ ok: boolean }> {
  try {
    const { principal, db } = await getCustomerContext();
    allow(principal, "markMemberUpdatesRead");
    await markMemberUpdatesRead(db, principal, memberId, { upTo });
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiError) return { ok: false };
    throw err;
  }
}
