-- DropForeignKey
ALTER TABLE "levels" DROP CONSTRAINT "levels_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "levels" DROP CONSTRAINT "levels_sport_id_fkey";

-- DropForeignKey
ALTER TABLE "member_levels" DROP CONSTRAINT "member_levels_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "member_levels" DROP CONSTRAINT "member_levels_member_id_fkey";

-- DropForeignKey
ALTER TABLE "member_levels" DROP CONSTRAINT "member_levels_level_id_fkey";

-- DropForeignKey
ALTER TABLE "member_levels" DROP CONSTRAINT "member_levels_awarded_by_id_fkey";

-- DropForeignKey
ALTER TABLE "goals" DROP CONSTRAINT "goals_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "goals" DROP CONSTRAINT "goals_member_id_fkey";

-- DropForeignKey
ALTER TABLE "goals" DROP CONSTRAINT "goals_sport_id_fkey";

-- DropForeignKey
ALTER TABLE "goals" DROP CONSTRAINT "goals_target_level_id_fkey";

-- DropForeignKey
ALTER TABLE "goals" DROP CONSTRAINT "goals_created_by_id_fkey";

-- DropForeignKey
ALTER TABLE "achievements" DROP CONSTRAINT "achievements_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "achievements" DROP CONSTRAINT "achievements_member_id_fkey";

-- DropForeignKey
ALTER TABLE "achievements" DROP CONSTRAINT "achievements_goal_id_fkey";

-- DropTable
DROP TABLE "levels";

-- DropTable
DROP TABLE "member_levels";

-- DropTable
DROP TABLE "goals";

-- DropTable
DROP TABLE "achievements";

-- DropEnum
DROP TYPE "GoalStatus";

-- DropEnum
DROP TYPE "MeasureUnit";
