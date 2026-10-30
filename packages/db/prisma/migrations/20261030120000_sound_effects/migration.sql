-- Efeitos sonoros por servidor (ADR-0016). Reversão: DROP TABLE "SoundEffect";
CREATE TABLE "SoundEffect" (
    "id" UUID NOT NULL,
    "serverId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "emoji" TEXT,
    "volume" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "storageKey" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SoundEffect_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SoundEffect_serverId_idx" ON "SoundEffect"("serverId");
ALTER TABLE "SoundEffect" ADD CONSTRAINT "SoundEffect_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SoundEffect" ADD CONSTRAINT "SoundEffect_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
