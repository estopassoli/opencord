-- Reversão (os convites antigos não são recuperáveis; restaure o backup se precisar deles).
ALTER TABLE "Server" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "Invite" (
  "id" UUID NOT NULL, "serverId" UUID NOT NULL, "tokenHash" TEXT NOT NULL, "createdBy" UUID NOT NULL,
  "maxUses" INTEGER, "uses" INTEGER NOT NULL DEFAULT 0, "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "revokedAt" TIMESTAMPTZ(3), "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Invite_tokenHash_key" ON "Invite"("tokenHash");
CREATE INDEX "Invite_serverId_idx" ON "Invite"("serverId");
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_uses_bounds" CHECK ("uses" >= 0 AND ("maxUses" IS NULL OR "uses" <= "maxUses"));
