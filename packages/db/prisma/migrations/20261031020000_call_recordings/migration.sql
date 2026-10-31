-- Gravações de chamada (ADR-0023). Aditiva: tabela nova. Reverter: DROP TABLE "CallRecording"; (os arquivos ficam no
-- armazenamento em recordings/ e expiram em 24 h; apagar a pasta junto).
-- CreateTable
CREATE TABLE "CallRecording" (
    "id" UUID NOT NULL,
    "serverId" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'recording',
    "storageKey" TEXT NOT NULL,
    "uploadId" TEXT,
    "parts" JSONB NOT NULL DEFAULT '[]',
    "sizeBytes" BIGINT NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CallRecording_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CallRecording_channelId_status_idx" ON "CallRecording"("channelId", "status");

-- CreateIndex
CREATE INDEX "CallRecording_expiresAt_idx" ON "CallRecording"("expiresAt");

-- AddForeignKey
ALTER TABLE "CallRecording" ADD CONSTRAINT "CallRecording_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallRecording" ADD CONSTRAINT "CallRecording_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallRecording" ADD CONSTRAINT "CallRecording_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

