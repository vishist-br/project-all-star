-- CreateTable
CREATE TABLE "magic_links" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "magic_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "access_hash" TEXT NOT NULL,
    "refresh_hash" TEXT NOT NULL,
    "access_expires_at" TIMESTAMP(3) NOT NULL,
    "refresh_expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "magic_links_token_hash_key" ON "magic_links"("token_hash");

-- CreateIndex
CREATE INDEX "magic_links_tenant_id_user_id_idx" ON "magic_links"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "magic_links_tenant_id_expires_at_idx" ON "magic_links"("tenant_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_access_hash_key" ON "auth_sessions"("access_hash");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_refresh_hash_key" ON "auth_sessions"("refresh_hash");

-- CreateIndex
CREATE INDEX "auth_sessions_tenant_id_user_id_idx" ON "auth_sessions"("tenant_id", "user_id");
