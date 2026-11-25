-- AlterTable
ALTER TABLE "workout_plans" ADD COLUMN     "folder_id" TEXT,
ADD COLUMN     "is_template" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "plan_folders" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "coach_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "body_measurements" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "measured_on" DATE NOT NULL,
    "weight_kg" DECIMAL(5,1) NOT NULL,
    "body_fat_pct" DECIMAL(4,1),
    "chest_cm" DECIMAL(4,1),
    "waist_cm" DECIMAL(4,1),
    "hip_cm" DECIMAL(4,1),
    "arm_cm" DECIMAL(4,1),
    "thigh_cm" DECIMAL(4,1),
    "note" TEXT,
    "recorded_by_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "body_measurements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "plan_folders_tenant_id_coach_id_sort_order_idx" ON "plan_folders"("tenant_id", "coach_id", "sort_order");

-- CreateIndex
CREATE INDEX "body_measurements_tenant_id_member_id_measured_on_idx" ON "body_measurements"("tenant_id", "member_id", "measured_on");

-- CreateIndex
CREATE UNIQUE INDEX "body_measurements_tenant_id_member_id_measured_on_key" ON "body_measurements"("tenant_id", "member_id", "measured_on");

-- CreateIndex
CREATE INDEX "workout_plans_tenant_id_folder_id_idx" ON "workout_plans"("tenant_id", "folder_id");

-- AddForeignKey
ALTER TABLE "workout_plans" ADD CONSTRAINT "workout_plans_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "plan_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_folders" ADD CONSTRAINT "plan_folders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_folders" ADD CONSTRAINT "plan_folders_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "body_measurements" ADD CONSTRAINT "body_measurements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "body_measurements" ADD CONSTRAINT "body_measurements_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Range checks (the API validates the same limits)
ALTER TABLE "body_measurements" ADD CONSTRAINT "body_measurements_weight_check" CHECK ("weight_kg" > 0 AND "weight_kg" <= 500);
ALTER TABLE "body_measurements" ADD CONSTRAINT "body_measurements_body_fat_check" CHECK ("body_fat_pct" IS NULL OR ("body_fat_pct" >= 1 AND "body_fat_pct" <= 80));
