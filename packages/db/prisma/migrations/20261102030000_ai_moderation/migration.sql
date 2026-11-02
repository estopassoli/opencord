-- Moderação por IA (ADR-0036): casos retidos, anexos presos ao caso, regras por servidor e chaves da instância. Aditiva.
-- Reverter: ALTER TABLE "Attachment" DROP COLUMN "caseId"; DROP TABLE "ModerationCase";
--           ALTER TABLE "Server" DROP COLUMN "aiRules";
--           ALTER TABLE "InstanceConfig" DROP COLUMN "aiModeration", DROP COLUMN "aiModerationDms";
ALTER TABLE "Server" ADD COLUMN "aiRules" TEXT;
ALTER TABLE "InstanceConfig" ADD COLUMN "aiModeration" BOOLEAN NOT NULL DEFAULT true,
                             ADD COLUMN "aiModerationDms" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "ModerationCase" (
    "id" UUID NOT NULL,
    "serverId" UUID,
    "channelId" UUID,
    "conversationId" UUID,
    "authorId" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "replyToId" UUID,
    "verdict" TEXT NOT NULL,
    "category" TEXT,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMPTZ(3),
    "reviewNote" TEXT,
    "publishedMessageId" UUID,
    "model" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ModerationCase_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ModerationCase_serverId_status_createdAt_idx" ON "ModerationCase"("serverId", "status", "createdAt");
CREATE INDEX "ModerationCase_authorId_createdAt_idx" ON "ModerationCase"("authorId", "createdAt");
ALTER TABLE "ModerationCase" ADD CONSTRAINT "ModerationCase_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModerationCase" ADD CONSTRAINT "ModerationCase_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Attachment" ADD COLUMN "caseId" UUID;
CREATE INDEX "Attachment_caseId_idx" ON "Attachment"("caseId");
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ModerationCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
