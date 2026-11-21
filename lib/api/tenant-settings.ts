import type { PrismaClient } from "@prisma/client";
import { ApiError } from "../auth/errors";
import type { TenantClient } from "../tenant-scope";
import { getThemeForTenant } from "../theme";

export const DEFAULT_SETTINGS = {
  bookingCancelWindowMinutes: 120,
  waitlistEnabled: true,
  showMissedSessionCost: false,
} as const;

export type TenantSettingsDto = {
  bookingCancelWindowMinutes: number;
  waitlistEnabled: boolean;
  showMissedSessionCost: boolean;
};

/** Settings of the scoped tenant; no row means the defaults. */
export async function loadTenantSettings(db: Pick<TenantClient, "tenantSettings">): Promise<TenantSettingsDto> {
  const row = await db.tenantSettings.findFirst({
    select: { bookingCancelWindowMinutes: true, waitlistEnabled: true, showMissedSessionCost: true },
  });
  return row ?? { ...DEFAULT_SETTINGS };
}

/** The `Tenant` schema: GET /tenant and the PUT /tenant/settings response. */
export async function getTenantProfile(client: PrismaClient, db: TenantClient, tenantId: string) {
  const [theme, settings] = await Promise.all([getThemeForTenant(client, tenantId), loadTenantSettings(db)]);
  return {
    id: tenantId,
    slug: theme.tenantSlug,
    // Timezone is not stored per tenant yet; venues carry it. Default for India.
    timezone: "Asia/Kolkata",
    theme,
    ...settings,
  };
}

function fail(field: string, message: string): never {
  throw new ApiError("validation_failed", `${field}: ${message}`, [{ field, message }]);
}

/** PUT /tenant/settings (updateTenantSettings): partial update, creates the row on first use. */
export async function updateTenantSettings(db: TenantClient, tenantId: string, body: Record<string, unknown>) {
  const known = ["bookingCancelWindowMinutes", "waitlistEnabled", "showMissedSessionCost"];
  for (const k of Object.keys(body)) if (!known.includes(k)) fail(k, "unknown field");
  if (!known.some((k) => body[k] !== undefined)) fail("body", `one of ${known.join(", ")}`);
  const data: Partial<TenantSettingsDto> = {};
  const w = body.bookingCancelWindowMinutes;
  if (w !== undefined) {
    if (typeof w !== "number" || !Number.isInteger(w) || w < 0 || w > 2880) {
      fail("bookingCancelWindowMinutes", "integer 0..2880");
    }
    data.bookingCancelWindowMinutes = w;
  }
  for (const k of ["waitlistEnabled", "showMissedSessionCost"] as const) {
    if (body[k] === undefined) continue;
    if (typeof body[k] !== "boolean") fail(k, "boolean");
    data[k] = body[k] as boolean;
  }
  await db.tenantSettings.upsert({
    where: { tenantId },
    create: { tenantId, ...data },
    update: data,
  });
}
