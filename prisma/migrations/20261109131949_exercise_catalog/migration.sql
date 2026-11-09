-- CreateEnum
CREATE TYPE "ExerciseSource" AS ENUM ('FREE_EXERCISE_DB', 'ORIGINAL');

-- CreateTable
CREATE TABLE "exercises" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "source" "ExerciseSource" NOT NULL,
    "source_id" TEXT NOT NULL,
    "sport_slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "level" TEXT,
    "equipment" TEXT,
    "force" TEXT,
    "mechanic" TEXT,
    "primary_muscles" TEXT[],
    "secondary_muscles" TEXT[],
    "instructions" TEXT[],
    "licence" TEXT NOT NULL,
    "source_commit" TEXT,
    "needs_trainer_review" BOOLEAN NOT NULL DEFAULT true,
    "reviewed_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exercises_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "exercises_tenant_id_sport_slug_idx" ON "exercises"("tenant_id", "sport_slug");

-- CreateIndex
CREATE INDEX "exercises_tenant_id_needs_trainer_review_idx" ON "exercises"("tenant_id", "needs_trainer_review");

-- CreateIndex
CREATE UNIQUE INDEX "exercises_tenant_id_source_source_id_key" ON "exercises"("tenant_id", "source", "source_id");

-- AddForeignKey
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
