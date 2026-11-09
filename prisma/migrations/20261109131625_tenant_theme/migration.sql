-- CreateTable
CREATE TABLE "tenant_themes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "brand_name" TEXT NOT NULL,
    "logo_url" TEXT,
    "primary_hex" TEXT NOT NULL,
    "secondary_hex" TEXT NOT NULL,
    "accent_hex" TEXT NOT NULL,
    "surface_hex" TEXT NOT NULL DEFAULT '#FFFFFF',
    "text_hex" TEXT NOT NULL DEFAULT '#111111',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_themes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_themes_tenant_id_key" ON "tenant_themes"("tenant_id");

-- AddForeignKey
ALTER TABLE "tenant_themes" ADD CONSTRAINT "tenant_themes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
