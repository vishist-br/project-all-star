-- CreateEnum
CREATE TYPE "PlanCadence" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ENDED');

-- CreateEnum
CREATE TYPE "WorkoutLogStatus" AS ENUM ('STARTED', 'STOPPED', 'COMPLETED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('BOOKED', 'WAITLISTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GoalMetric" AS ENUM ('SESSIONS_ATTENDED', 'WORKOUTS_COMPLETED', 'LEVEL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "MemberUpdateKind" AS ENUM ('PLAN_ASSIGNED', 'PLAN_UPDATED', 'PLAN_ENDED', 'GOAL_SET', 'GOAL_UPDATED', 'SESSION_SCHEDULED', 'SESSION_RESCHEDULED', 'SESSION_CANCELLED', 'BOOKING_CONFIRMED', 'WAITLIST_PROMOTED');

-- AlterTable
ALTER TABLE "goals" ADD COLUMN     "metric" "GoalMetric" NOT NULL DEFAULT 'SESSIONS_ATTENDED',
ADD COLUMN     "start_value" DECIMAL(10,2),
ADD COLUMN     "starts_on" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "target_value" DECIMAL(10,2),
ADD COLUMN     "unit" TEXT;

-- AlterTable
ALTER TABLE "members" ADD COLUMN     "leftOn" DATE;

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "cancel_reason" TEXT,
ADD COLUMN     "cancelled_at" TIMESTAMP(3),
ADD COLUMN     "capacity" INTEGER,
ADD COLUMN     "title" TEXT;

-- CreateTable
CREATE TABLE "workout_plans" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "coach_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "cadence" "PlanCadence" NOT NULL,
    "sport_slug" TEXT,
    "status" "PlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "archived_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workout_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_plan_days" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "day_index" INTEGER NOT NULL,
    "title" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workout_plan_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_plan_items" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "day_id" TEXT NOT NULL,
    "exercise_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "sets" INTEGER,
    "reps" INTEGER,
    "duration_seconds" INTEGER,
    "rest_seconds" INTEGER,
    "notes" TEXT,
    "archived_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workout_plan_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_assignments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "assigned_by_id" TEXT NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "starts_on" DATE NOT NULL,
    "ends_on" DATE,
    "plan_version" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "assignment_id" TEXT NOT NULL,
    "plan_item_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "scheduled_for" DATE NOT NULL,
    "status" "WorkoutLogStatus" NOT NULL,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "actual_sets" INTEGER,
    "actual_reps" INTEGER,
    "actual_duration_seconds" INTEGER,
    "note" TEXT,
    "client_id" TEXT NOT NULL,
    "recorded_by_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workout_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_updates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "kind" "MemberUpdateKind" NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "read_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coach_availability" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "coach_id" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "venue_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coach_availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_bookings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "status" "BookingStatus" NOT NULL,
    "waitlist_position" INTEGER,
    "booked_by_id" TEXT NOT NULL,
    "cancelled_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "booking_cancel_window_minutes" INTEGER NOT NULL DEFAULT 120,
    "waitlist_enabled" BOOLEAN NOT NULL DEFAULT true,
    "show_missed_session_cost" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_check_ins" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "goal_id" TEXT NOT NULL,
    "value" DECIMAL(10,2) NOT NULL,
    "note" TEXT,
    "recorded_on" DATE NOT NULL,
    "recorded_by_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goal_check_ins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workout_plans_tenant_id_coach_id_status_idx" ON "workout_plans"("tenant_id", "coach_id", "status");

-- CreateIndex
CREATE INDEX "workout_plans_tenant_id_status_idx" ON "workout_plans"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "workout_plan_days_tenant_id_plan_id_day_index_key" ON "workout_plan_days"("tenant_id", "plan_id", "day_index");

-- CreateIndex
CREATE INDEX "workout_plan_items_tenant_id_day_id_position_idx" ON "workout_plan_items"("tenant_id", "day_id", "position");

-- CreateIndex
CREATE INDEX "workout_plan_items_tenant_id_exercise_id_idx" ON "workout_plan_items"("tenant_id", "exercise_id");

-- CreateIndex
CREATE INDEX "plan_assignments_tenant_id_member_id_status_idx" ON "plan_assignments"("tenant_id", "member_id", "status");

-- CreateIndex
CREATE INDEX "plan_assignments_tenant_id_plan_id_status_idx" ON "plan_assignments"("tenant_id", "plan_id", "status");

-- CreateIndex
CREATE INDEX "workout_logs_tenant_id_member_id_scheduled_for_idx" ON "workout_logs"("tenant_id", "member_id", "scheduled_for");

-- CreateIndex
CREATE INDEX "workout_logs_tenant_id_status_scheduled_for_idx" ON "workout_logs"("tenant_id", "status", "scheduled_for");

-- CreateIndex
CREATE UNIQUE INDEX "workout_logs_tenant_id_assignment_id_plan_item_id_scheduled_key" ON "workout_logs"("tenant_id", "assignment_id", "plan_item_id", "scheduled_for");

-- CreateIndex
CREATE UNIQUE INDEX "workout_logs_tenant_id_client_id_key" ON "workout_logs"("tenant_id", "client_id");

-- CreateIndex
CREATE INDEX "member_updates_tenant_id_member_id_createdAt_idx" ON "member_updates"("tenant_id", "member_id", "createdAt");

-- CreateIndex
CREATE INDEX "member_updates_tenant_id_member_id_read_at_idx" ON "member_updates"("tenant_id", "member_id", "read_at");

-- CreateIndex
CREATE INDEX "coach_availability_tenant_id_coach_id_weekday_idx" ON "coach_availability"("tenant_id", "coach_id", "weekday");

-- CreateIndex
CREATE INDEX "session_bookings_tenant_id_session_id_status_idx" ON "session_bookings"("tenant_id", "session_id", "status");

-- CreateIndex
CREATE INDEX "session_bookings_tenant_id_member_id_status_idx" ON "session_bookings"("tenant_id", "member_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "session_bookings_tenant_id_session_id_member_id_key" ON "session_bookings"("tenant_id", "session_id", "member_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_settings_tenant_id_key" ON "tenant_settings"("tenant_id");

-- CreateIndex
CREATE INDEX "goal_check_ins_tenant_id_goal_id_recorded_on_idx" ON "goal_check_ins"("tenant_id", "goal_id", "recorded_on");

-- AddForeignKey
ALTER TABLE "workout_plans" ADD CONSTRAINT "workout_plans_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_plans" ADD CONSTRAINT "workout_plans_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_plan_days" ADD CONSTRAINT "workout_plan_days_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_plan_days" ADD CONSTRAINT "workout_plan_days_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "workout_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_plan_items" ADD CONSTRAINT "workout_plan_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_plan_items" ADD CONSTRAINT "workout_plan_items_day_id_fkey" FOREIGN KEY ("day_id") REFERENCES "workout_plan_days"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_plan_items" ADD CONSTRAINT "workout_plan_items_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_assignments" ADD CONSTRAINT "plan_assignments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_assignments" ADD CONSTRAINT "plan_assignments_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "workout_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_assignments" ADD CONSTRAINT "plan_assignments_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_assignments" ADD CONSTRAINT "plan_assignments_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_logs" ADD CONSTRAINT "workout_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_logs" ADD CONSTRAINT "workout_logs_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "plan_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_logs" ADD CONSTRAINT "workout_logs_plan_item_id_fkey" FOREIGN KEY ("plan_item_id") REFERENCES "workout_plan_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_logs" ADD CONSTRAINT "workout_logs_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_logs" ADD CONSTRAINT "workout_logs_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_updates" ADD CONSTRAINT "member_updates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_updates" ADD CONSTRAINT "member_updates_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_updates" ADD CONSTRAINT "member_updates_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_availability" ADD CONSTRAINT "coach_availability_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_availability" ADD CONSTRAINT "coach_availability_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_availability" ADD CONSTRAINT "coach_availability_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_bookings" ADD CONSTRAINT "session_bookings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_bookings" ADD CONSTRAINT "session_bookings_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_bookings" ADD CONSTRAINT "session_bookings_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_bookings" ADD CONSTRAINT "session_bookings_booked_by_id_fkey" FOREIGN KEY ("booked_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_check_ins" ADD CONSTRAINT "goal_check_ins_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_check_ins" ADD CONSTRAINT "goal_check_ins_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- CHECK constraints (hand written; Prisma cannot express them)
ALTER TABLE "workout_plan_items" ADD CONSTRAINT "workout_plan_items_target_check" CHECK ("reps" IS NOT NULL OR "duration_seconds" IS NOT NULL);
ALTER TABLE "workout_plan_items" ADD CONSTRAINT "workout_plan_items_sets_check" CHECK ("sets" IS NULL OR "sets" BETWEEN 1 AND 20);
ALTER TABLE "workout_plan_items" ADD CONSTRAINT "workout_plan_items_reps_check" CHECK ("reps" IS NULL OR "reps" BETWEEN 1 AND 200);
ALTER TABLE "workout_plan_items" ADD CONSTRAINT "workout_plan_items_duration_check" CHECK ("duration_seconds" IS NULL OR "duration_seconds" BETWEEN 1 AND 7200);
ALTER TABLE "workout_plan_items" ADD CONSTRAINT "workout_plan_items_rest_check" CHECK ("rest_seconds" IS NULL OR "rest_seconds" BETWEEN 0 AND 900);
ALTER TABLE "workout_plan_days" ADD CONSTRAINT "workout_plan_days_day_index_check" CHECK ("day_index" BETWEEN 1 AND 31);
ALTER TABLE "coach_availability" ADD CONSTRAINT "coach_availability_weekday_check" CHECK ("weekday" BETWEEN 1 AND 7);
ALTER TABLE "coach_availability" ADD CONSTRAINT "coach_availability_time_order_check" CHECK ("start_time" < "end_time");
ALTER TABLE "session_bookings" ADD CONSTRAINT "session_bookings_waitlist_position_check" CHECK (("status" = 'WAITLISTED') = ("waitlist_position" IS NOT NULL));
ALTER TABLE "plan_assignments" ADD CONSTRAINT "plan_assignments_dates_check" CHECK ("ends_on" IS NULL OR "ends_on" >= "starts_on");

-- One live (ACTIVE or PAUSED) assignment per plan and member
CREATE UNIQUE INDEX "plan_assignments_live_unique" ON "plan_assignments"("tenant_id", "plan_id", "member_id") WHERE "status" <> 'ENDED';
