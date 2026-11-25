-- Local rollback only (Prisma ignores this file). Removes plan folders, templates and body measurements.
DROP TABLE IF EXISTS "body_measurements";
ALTER TABLE "workout_plans" DROP CONSTRAINT IF EXISTS "workout_plans_folder_id_fkey";
DROP INDEX IF EXISTS "workout_plans_tenant_id_folder_id_idx";
ALTER TABLE "workout_plans" DROP COLUMN IF EXISTS "folder_id", DROP COLUMN IF EXISTS "is_template";
DROP TABLE IF EXISTS "plan_folders";
