-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'EXCUSED');

-- CreateEnum
CREATE TYPE "ExcuseReason" AS ENUM ('EXAM', 'ILLNESS', 'FESTIVAL', 'TRAVEL');

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "coach_id" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "completedAt" TIMESTAMP(3),
    "coachNote" TEXT,
    "client_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "reason" "ExcuseReason",
    "note" TEXT,
    "photo_ref" TEXT,
    "client_id" TEXT NOT NULL,
    "marked_by_id" TEXT NOT NULL,
    "markedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "excused_absences" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "reason" "ExcuseReason" NOT NULL,
    "note" TEXT,
    "created_by_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "excused_absences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holidays" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sessions_tenant_id_startsAt_idx" ON "sessions"("tenant_id", "startsAt");

-- CreateIndex
CREATE INDEX "sessions_tenant_id_coach_id_startsAt_idx" ON "sessions"("tenant_id", "coach_id", "startsAt");

-- CreateIndex
CREATE INDEX "sessions_tenant_id_status_startsAt_idx" ON "sessions"("tenant_id", "status", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tenant_id_batch_id_startsAt_key" ON "sessions"("tenant_id", "batch_id", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tenant_id_client_id_key" ON "sessions"("tenant_id", "client_id");

-- CreateIndex
CREATE INDEX "attendance_tenant_id_member_id_status_idx" ON "attendance"("tenant_id", "member_id", "status");

-- CreateIndex
CREATE INDEX "attendance_tenant_id_updatedAt_idx" ON "attendance"("tenant_id", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_tenant_id_session_id_member_id_key" ON "attendance"("tenant_id", "session_id", "member_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_tenant_id_client_id_key" ON "attendance"("tenant_id", "client_id");

-- CreateIndex
CREATE INDEX "excused_absences_tenant_id_member_id_fromDate_idx" ON "excused_absences"("tenant_id", "member_id", "fromDate");

-- CreateIndex
CREATE UNIQUE INDEX "holidays_tenant_id_date_key" ON "holidays"("tenant_id", "date");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_marked_by_id_fkey" FOREIGN KEY ("marked_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "excused_absences" ADD CONSTRAINT "excused_absences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "excused_absences" ADD CONSTRAINT "excused_absences_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "excused_absences" ADD CONSTRAINT "excused_absences_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data integrity checks (not expressible in Prisma schema)
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_reason_iff_excused"
  CHECK (("status" = 'EXCUSED' AND "reason" IS NOT NULL) OR ("status" <> 'EXCUSED' AND "reason" IS NULL));
ALTER TABLE "excused_absences" ADD CONSTRAINT "excused_absences_date_order" CHECK ("toDate" >= "fromDate");
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_time_order" CHECK ("endsAt" > "startsAt");
