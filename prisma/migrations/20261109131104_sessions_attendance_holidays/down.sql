-- DropForeignKey
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_batch_id_fkey";

-- DropForeignKey
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_coach_id_fkey";

-- DropForeignKey
ALTER TABLE "attendance" DROP CONSTRAINT "attendance_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "attendance" DROP CONSTRAINT "attendance_session_id_fkey";

-- DropForeignKey
ALTER TABLE "attendance" DROP CONSTRAINT "attendance_member_id_fkey";

-- DropForeignKey
ALTER TABLE "attendance" DROP CONSTRAINT "attendance_marked_by_id_fkey";

-- DropForeignKey
ALTER TABLE "excused_absences" DROP CONSTRAINT "excused_absences_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "excused_absences" DROP CONSTRAINT "excused_absences_member_id_fkey";

-- DropForeignKey
ALTER TABLE "excused_absences" DROP CONSTRAINT "excused_absences_created_by_id_fkey";

-- DropForeignKey
ALTER TABLE "holidays" DROP CONSTRAINT "holidays_tenant_id_fkey";

-- DropTable
DROP TABLE "sessions";

-- DropTable
DROP TABLE "attendance";

-- DropTable
DROP TABLE "excused_absences";

-- DropTable
DROP TABLE "holidays";

-- DropEnum
DROP TYPE "SessionStatus";

-- DropEnum
DROP TYPE "AttendanceStatus";

-- DropEnum
DROP TYPE "ExcuseReason";
