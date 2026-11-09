-- Clipes na conta (ADR-0057): vídeo e miniatura são anexos sem mensagem presos ao clipe; até 6 em destaque no perfil.
-- Reversão: DROP TABLE "ProfileClip"; (os anexos viram órfãos e a limpeza periódica apaga os arquivos)
CREATE TABLE "ProfileClip" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "videoId" UUID NOT NULL,
    "thumbId" UUID,
    "title" TEXT NOT NULL,
    "game" TEXT,
    "durationMs" INTEGER NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfileClip_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProfileClip_videoId_key" ON "ProfileClip"("videoId");
CREATE UNIQUE INDEX "ProfileClip_thumbId_key" ON "ProfileClip"("thumbId");
CREATE INDEX "ProfileClip_userId_createdAt_idx" ON "ProfileClip"("userId", "createdAt");

ALTER TABLE "ProfileClip" ADD CONSTRAINT "ProfileClip_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProfileClip" ADD CONSTRAINT "ProfileClip_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Attachment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProfileClip" ADD CONSTRAINT "ProfileClip_thumbId_fkey" FOREIGN KEY ("thumbId") REFERENCES "Attachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
