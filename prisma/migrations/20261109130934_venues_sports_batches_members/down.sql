-- DropForeignKey
ALTER TABLE "venues" DROP CONSTRAINT "venues_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "sports" DROP CONSTRAINT "sports_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "batches" DROP CONSTRAINT "batches_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "batches" DROP CONSTRAINT "batches_venue_id_fkey";

-- DropForeignKey
ALTER TABLE "batches" DROP CONSTRAINT "batches_sport_id_fkey";

-- DropForeignKey
ALTER TABLE "batches" DROP CONSTRAINT "batches_coach_id_fkey";

-- DropForeignKey
ALTER TABLE "guardians" DROP CONSTRAINT "guardians_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "guardians" DROP CONSTRAINT "guardians_user_id_fkey";

-- DropForeignKey
ALTER TABLE "members" DROP CONSTRAINT "members_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "members" DROP CONSTRAINT "members_guardian_id_fkey";

-- DropForeignKey
ALTER TABLE "members" DROP CONSTRAINT "members_user_id_fkey";

-- DropForeignKey
ALTER TABLE "batch_members" DROP CONSTRAINT "batch_members_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "batch_members" DROP CONSTRAINT "batch_members_batch_id_fkey";

-- DropForeignKey
ALTER TABLE "batch_members" DROP CONSTRAINT "batch_members_member_id_fkey";

-- DropTable
DROP TABLE "venues";

-- DropTable
DROP TABLE "sports";

-- DropTable
DROP TABLE "batches";

-- DropTable
DROP TABLE "guardians";

-- DropTable
DROP TABLE "members";

-- DropTable
DROP TABLE "batch_members";

-- DropEnum
DROP TYPE "BatchKind";

-- DropEnum
DROP TYPE "FeeStatus";

-- DropEnum
DROP TYPE "FeePaidMethod";
