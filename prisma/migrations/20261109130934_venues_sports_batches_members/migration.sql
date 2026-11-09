-- CreateEnum
CREATE TYPE "BatchKind" AS ENUM ('GROUP_CLASS', 'ONE_ON_ONE');

-- CreateEnum
CREATE TYPE "FeeStatus" AS ENUM ('PAID', 'DUE', 'OVERDUE', 'WAIVED');

-- CreateEnum
CREATE TYPE "FeePaidMethod" AS ENUM ('CASH', 'UPI');

-- CreateTable
CREATE TABLE "venues" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "venues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sports" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batches" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "venue_id" TEXT NOT NULL,
    "sport_id" TEXT NOT NULL,
    "coach_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "BatchKind" NOT NULL DEFAULT 'GROUP_CLASS',
    "capacity" INTEGER,
    "daysOfWeek" INTEGER[],
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "startsOn" DATE,
    "endsOn" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardians" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guardians_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "members" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "birthYear" INTEGER,
    "isMinor" BOOLEAN NOT NULL DEFAULT false,
    "guardian_id" TEXT,
    "user_id" TEXT,
    "phone" TEXT,
    "joinedOn" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "feeStatus" "FeeStatus" NOT NULL DEFAULT 'DUE',
    "feeDueOn" DATE,
    "feePaidOn" DATE,
    "feePaidMethod" "FeePaidMethod",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch_members" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "joinedOn" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "batch_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "venues_tenant_id_isActive_idx" ON "venues"("tenant_id", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "venues_tenant_id_name_key" ON "venues"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "sports_tenant_id_idx" ON "sports"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "sports_tenant_id_slug_key" ON "sports"("tenant_id", "slug");

-- CreateIndex
CREATE INDEX "batches_tenant_id_isActive_idx" ON "batches"("tenant_id", "isActive");

-- CreateIndex
CREATE INDEX "batches_tenant_id_coach_id_idx" ON "batches"("tenant_id", "coach_id");

-- CreateIndex
CREATE INDEX "batches_tenant_id_venue_id_idx" ON "batches"("tenant_id", "venue_id");

-- CreateIndex
CREATE INDEX "batches_tenant_id_sport_id_idx" ON "batches"("tenant_id", "sport_id");

-- CreateIndex
CREATE INDEX "guardians_tenant_id_idx" ON "guardians"("tenant_id");

-- CreateIndex
CREATE INDEX "guardians_tenant_id_user_id_idx" ON "guardians"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "members_tenant_id_isActive_idx" ON "members"("tenant_id", "isActive");

-- CreateIndex
CREATE INDEX "members_tenant_id_guardian_id_idx" ON "members"("tenant_id", "guardian_id");

-- CreateIndex
CREATE INDEX "members_tenant_id_user_id_idx" ON "members"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "members_tenant_id_feeStatus_idx" ON "members"("tenant_id", "feeStatus");

-- CreateIndex
CREATE INDEX "batch_members_tenant_id_member_id_idx" ON "batch_members"("tenant_id", "member_id");

-- CreateIndex
CREATE UNIQUE INDEX "batch_members_tenant_id_batch_id_member_id_key" ON "batch_members"("tenant_id", "batch_id", "member_id");

-- AddForeignKey
ALTER TABLE "venues" ADD CONSTRAINT "venues_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sports" ADD CONSTRAINT "sports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_sport_id_fkey" FOREIGN KEY ("sport_id") REFERENCES "sports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_guardian_id_fkey" FOREIGN KEY ("guardian_id") REFERENCES "guardians"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_members" ADD CONSTRAINT "batch_members_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_members" ADD CONSTRAINT "batch_members_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_members" ADD CONSTRAINT "batch_members_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
