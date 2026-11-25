-- Local rollback only (Prisma ignores this file). Removes the workout engine core.
-- Postgres cannot drop enum values: the three MemberUpdateKind values (CLASS_SUMMARY,
-- CLASS_CATCHUP, CLASS_CATCHUP_EXCUSED) stay in the type, which is harmless.
DELETE FROM "member_updates" WHERE "kind"::text IN ('CLASS_SUMMARY', 'CLASS_CATCHUP', 'CLASS_CATCHUP_EXCUSED');
ALTER TABLE "workout_plan_items" DROP CONSTRAINT IF EXISTS "workout_plan_items_rounds_check", DROP CONSTRAINT IF EXISTS "workout_plan_items_target_distance_check", DROP CONSTRAINT IF EXISTS "workout_plan_items_target_check";
ALTER TABLE "workout_plan_items" ADD CONSTRAINT "workout_plan_items_target_check" CHECK ("reps" IS NOT NULL OR "duration_seconds" IS NOT NULL);
DROP TABLE IF EXISTS "skill_sign_offs";
DROP TABLE IF EXISTS "skill_items";
DROP TABLE IF EXISTS "skill_checklists";
DROP TABLE IF EXISTS "class_summary_shares";
DROP TABLE IF EXISTS "class_summaries";
DROP TABLE IF EXISTS "workout_sets";
ALTER TABLE "sessions" DROP CONSTRAINT IF EXISTS "sessions_plan_day_id_fkey";
DROP INDEX IF EXISTS "sessions_tenant_id_plan_day_id_idx";
ALTER TABLE "sessions" DROP COLUMN IF EXISTS "plan_day_id";
ALTER TABLE "workout_plan_items" DROP COLUMN IF EXISTS "rounds", DROP COLUMN IF EXISTS "superset_group", DROP COLUMN IF EXISTS "target_distance_meters", DROP COLUMN IF EXISTS "target_weight_kg";
ALTER TABLE "exercises" DROP COLUMN IF EXISTS "metric_type";
DROP TYPE IF EXISTS "SetType";
DROP TYPE IF EXISTS "MetricType";
