-- AlterTable
ALTER TABLE "excused_absences" ADD COLUMN     "cancelled_at" TIMESTAMP(3),
ADD COLUMN     "session_id" TEXT;

-- CreateIndex
CREATE INDEX "excused_absences_tenant_id_fromDate_toDate_idx" ON "excused_absences"("tenant_id", "fromDate", "toDate");

-- CreateIndex
CREATE INDEX "excused_absences_tenant_id_session_id_idx" ON "excused_absences"("tenant_id", "session_id");

-- AddForeignKey
ALTER TABLE "excused_absences" ADD CONSTRAINT "excused_absences_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
