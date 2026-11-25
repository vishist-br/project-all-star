-- CreateEnum
CREATE TYPE "MetricType" AS ENUM ('WEIGHT_REPS', 'REPS', 'TIME', 'DISTANCE_TIME', 'SCORE', 'CHECKLIST');

-- CreateEnum
CREATE TYPE "SetType" AS ENUM ('NORMAL', 'WARMUP', 'DROP', 'FAILURE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MemberUpdateKind" ADD VALUE 'CLASS_SUMMARY';
ALTER TYPE "MemberUpdateKind" ADD VALUE 'CLASS_CATCHUP';
ALTER TYPE "MemberUpdateKind" ADD VALUE 'CLASS_CATCHUP_EXCUSED';

-- AlterTable
ALTER TABLE "exercises" ADD COLUMN     "metric_type" "MetricType" NOT NULL DEFAULT 'WEIGHT_REPS';

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "plan_day_id" TEXT;

-- AlterTable
ALTER TABLE "workout_plan_items" ADD COLUMN     "rounds" INTEGER,
ADD COLUMN     "superset_group" TEXT,
ADD COLUMN     "target_distance_meters" INTEGER,
ADD COLUMN     "target_weight_kg" DECIMAL(7,2);

-- CreateTable
CREATE TABLE "workout_sets" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "log_id" TEXT NOT NULL,
    "set_number" INTEGER NOT NULL,
    "set_type" "SetType" NOT NULL DEFAULT 'NORMAL',
    "weight_kg" DECIMAL(7,2),
    "reps" INTEGER,
    "seconds" INTEGER,
    "meters" INTEGER,
    "score_made" INTEGER,
    "score_of" INTEGER,
    "rating" INTEGER,
    "completed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "client_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workout_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_summaries" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "coach_note" TEXT,
    "home_practice" TEXT,
    "workout_snapshot" JSONB,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_by_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_summary_shares" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "summary_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_summary_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_checklists" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "sport_id" TEXT NOT NULL,
    "level_id" TEXT,
    "title" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_checklists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_items" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "checklist_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_sign_offs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "skill_item_id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "note" TEXT,
    "signed_off_by_id" TEXT,
    "signed_off_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_sign_offs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workout_sets_tenant_id_log_id_set_number_idx" ON "workout_sets"("tenant_id", "log_id", "set_number");

-- CreateIndex
CREATE UNIQUE INDEX "workout_sets_tenant_id_client_id_key" ON "workout_sets"("tenant_id", "client_id");

-- CreateIndex
CREATE INDEX "class_summaries_tenant_id_published_at_idx" ON "class_summaries"("tenant_id", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "class_summaries_tenant_id_session_id_key" ON "class_summaries"("tenant_id", "session_id");

-- CreateIndex
CREATE UNIQUE INDEX "class_summary_shares_token_hash_key" ON "class_summary_shares"("token_hash");

-- CreateIndex
CREATE INDEX "class_summary_shares_tenant_id_summary_id_idx" ON "class_summary_shares"("tenant_id", "summary_id");

-- CreateIndex
CREATE INDEX "class_summary_shares_tenant_id_member_id_idx" ON "class_summary_shares"("tenant_id", "member_id");

-- CreateIndex
CREATE INDEX "skill_checklists_tenant_id_sport_id_sort_order_idx" ON "skill_checklists"("tenant_id", "sport_id", "sort_order");

-- CreateIndex
CREATE INDEX "skill_checklists_tenant_id_level_id_idx" ON "skill_checklists"("tenant_id", "level_id");

-- CreateIndex
CREATE INDEX "skill_items_tenant_id_checklist_id_sort_order_idx" ON "skill_items"("tenant_id", "checklist_id", "sort_order");

-- CreateIndex
CREATE INDEX "skill_sign_offs_tenant_id_member_id_idx" ON "skill_sign_offs"("tenant_id", "member_id");

-- CreateIndex
CREATE UNIQUE INDEX "skill_sign_offs_tenant_id_member_id_skill_item_id_key" ON "skill_sign_offs"("tenant_id", "member_id", "skill_item_id");

-- CreateIndex
CREATE INDEX "sessions_tenant_id_plan_day_id_idx" ON "sessions"("tenant_id", "plan_day_id");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_plan_day_id_fkey" FOREIGN KEY ("plan_day_id") REFERENCES "workout_plan_days"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_log_id_fkey" FOREIGN KEY ("log_id") REFERENCES "workout_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_summaries" ADD CONSTRAINT "class_summaries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_summaries" ADD CONSTRAINT "class_summaries_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_summaries" ADD CONSTRAINT "class_summaries_published_by_id_fkey" FOREIGN KEY ("published_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_summary_shares" ADD CONSTRAINT "class_summary_shares_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_summary_shares" ADD CONSTRAINT "class_summary_shares_summary_id_fkey" FOREIGN KEY ("summary_id") REFERENCES "class_summaries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_summary_shares" ADD CONSTRAINT "class_summary_shares_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_summary_shares" ADD CONSTRAINT "class_summary_shares_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_checklists" ADD CONSTRAINT "skill_checklists_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_checklists" ADD CONSTRAINT "skill_checklists_sport_id_fkey" FOREIGN KEY ("sport_id") REFERENCES "sports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_checklists" ADD CONSTRAINT "skill_checklists_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "levels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_items" ADD CONSTRAINT "skill_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_items" ADD CONSTRAINT "skill_items_checklist_id_fkey" FOREIGN KEY ("checklist_id") REFERENCES "skill_checklists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_sign_offs" ADD CONSTRAINT "skill_sign_offs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_sign_offs" ADD CONSTRAINT "skill_sign_offs_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_sign_offs" ADD CONSTRAINT "skill_sign_offs_skill_item_id_fkey" FOREIGN KEY ("skill_item_id") REFERENCES "skill_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_sign_offs" ADD CONSTRAINT "skill_sign_offs_signed_off_by_id_fkey" FOREIGN KEY ("signed_off_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: gym exercises stay WEIGHT_REPS (the column default); every other sport counts reps.
UPDATE "exercises" SET "metric_type" = 'REPS' WHERE "sport_slug" <> 'gym';

-- CHECK constraints (hand written; Prisma cannot express them)
ALTER TABLE "workout_plan_items" DROP CONSTRAINT "workout_plan_items_target_check";
ALTER TABLE "workout_plan_items" ADD CONSTRAINT "workout_plan_items_target_check" CHECK ("reps" IS NOT NULL OR "duration_seconds" IS NOT NULL OR "target_distance_meters" IS NOT NULL);
ALTER TABLE "workout_plan_items" ADD CONSTRAINT "workout_plan_items_rounds_check" CHECK ("rounds" IS NULL OR ("rounds" BETWEEN 1 AND 20 AND "superset_group" IS NOT NULL));
ALTER TABLE "workout_plan_items" ADD CONSTRAINT "workout_plan_items_target_distance_check" CHECK ("target_distance_meters" IS NULL OR "target_distance_meters" BETWEEN 1 AND 100000);
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_rating_check" CHECK ("rating" IS NULL OR "rating" BETWEEN 1 AND 4);
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_score_check" CHECK (("score_made" IS NULL) = ("score_of" IS NULL) AND ("score_made" IS NULL OR "score_made" <= "score_of"));
ALTER TABLE "skill_sign_offs" ADD CONSTRAINT "skill_sign_offs_rating_check" CHECK ("rating" BETWEEN 1 AND 4);
