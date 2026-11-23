-- Local rollback only (Prisma ignores this file).
ALTER TABLE "excused_absences" DROP CONSTRAINT IF EXISTS "excused_absences_session_id_fkey";
DROP INDEX IF EXISTS "excused_absences_tenant_id_session_id_idx";
DROP INDEX IF EXISTS "excused_absences_tenant_id_fromDate_toDate_idx";
ALTER TABLE "excused_absences" DROP COLUMN IF EXISTS "session_id", DROP COLUMN IF EXISTS "cancelled_at";
