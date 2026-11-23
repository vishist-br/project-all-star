-- CreateTable
CREATE TABLE "coach_credentials" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "coach_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "issuer" TEXT,
    "year" INTEGER,
    "verified_at" TIMESTAMP(3),
    "verified_by_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coach_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "coach_credentials_tenant_id_coach_id_idx" ON "coach_credentials"("tenant_id", "coach_id");

-- AddForeignKey
ALTER TABLE "coach_credentials" ADD CONSTRAINT "coach_credentials_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_credentials" ADD CONSTRAINT "coach_credentials_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_credentials" ADD CONSTRAINT "coach_credentials_verified_by_id_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

