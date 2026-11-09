-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('ACTIVE', 'ACHIEVED', 'DROPPED');

-- CreateEnum
CREATE TYPE "MeasureUnit" AS ENUM ('HOURS', 'DAYS', 'STREAK_DAYS', 'SESSIONS');

-- CreateTable
CREATE TABLE "levels" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "sport_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "colorHex" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_levels" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "level_id" TEXT NOT NULL,
    "achievedOn" DATE NOT NULL,
    "awarded_by_id" TEXT,
    "coachNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goals" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "sport_id" TEXT,
    "target_level_id" TEXT,
    "title" TEXT NOT NULL,
    "targetSessions" INTEGER,
    "targetDate" DATE,
    "status" "GoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "achievements" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "goal_id" TEXT,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "measure_unit" "MeasureUnit" NOT NULL,
    "measure_value" DECIMAL(10,2) NOT NULL,
    "period_start" TIMESTAMP(3),
    "period_end" TIMESTAMP(3),
    "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "achievements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "levels_tenant_id_sport_id_rank_key" ON "levels"("tenant_id", "sport_id", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "levels_tenant_id_sport_id_name_key" ON "levels"("tenant_id", "sport_id", "name");

-- CreateIndex
CREATE INDEX "member_levels_tenant_id_member_id_achievedOn_idx" ON "member_levels"("tenant_id", "member_id", "achievedOn");

-- CreateIndex
CREATE UNIQUE INDEX "member_levels_tenant_id_member_id_level_id_key" ON "member_levels"("tenant_id", "member_id", "level_id");

-- CreateIndex
CREATE INDEX "goals_tenant_id_member_id_status_idx" ON "goals"("tenant_id", "member_id", "status");

-- CreateIndex
CREATE INDEX "achievements_tenant_id_member_id_earnedAt_idx" ON "achievements"("tenant_id", "member_id", "earnedAt");

-- CreateIndex
CREATE UNIQUE INDEX "achievements_tenant_id_member_id_code_measure_unit_earnedAt_key" ON "achievements"("tenant_id", "member_id", "code", "measure_unit", "earnedAt");

-- AddForeignKey
ALTER TABLE "levels" ADD CONSTRAINT "levels_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "levels" ADD CONSTRAINT "levels_sport_id_fkey" FOREIGN KEY ("sport_id") REFERENCES "sports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_levels" ADD CONSTRAINT "member_levels_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_levels" ADD CONSTRAINT "member_levels_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_levels" ADD CONSTRAINT "member_levels_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "levels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_levels" ADD CONSTRAINT "member_levels_awarded_by_id_fkey" FOREIGN KEY ("awarded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_sport_id_fkey" FOREIGN KEY ("sport_id") REFERENCES "sports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_target_level_id_fkey" FOREIGN KEY ("target_level_id") REFERENCES "levels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "goals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
