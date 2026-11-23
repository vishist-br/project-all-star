-- DropForeignKey
ALTER TABLE "public"."coach_credentials" DROP CONSTRAINT "coach_credentials_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."coach_credentials" DROP CONSTRAINT "coach_credentials_coach_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."coach_credentials" DROP CONSTRAINT "coach_credentials_verified_by_id_fkey";

-- DropTable
DROP TABLE "public"."coach_credentials";

