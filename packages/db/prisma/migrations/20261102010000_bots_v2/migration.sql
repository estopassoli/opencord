-- Bots v2 (ADR-0034): embeds e componentes em mensagens, castigo de membros e banimentos. Aditiva.
-- Reverter: DROP TABLE "ServerBan"; ALTER TABLE "ServerMember" DROP COLUMN "timeoutUntil";
--           ALTER TABLE "Message" DROP COLUMN "embeds", DROP COLUMN "components";
ALTER TABLE "Message" ADD COLUMN "embeds" JSONB NOT NULL DEFAULT '[]',
                      ADD COLUMN "components" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "ServerMember" ADD COLUMN "timeoutUntil" TIMESTAMPTZ(3);
CREATE TABLE "ServerBan" (
    "serverId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "reason" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServerBan_pkey" PRIMARY KEY ("serverId", "userId")
);
CREATE INDEX "ServerBan_userId_idx" ON "ServerBan"("userId");
ALTER TABLE "ServerBan" ADD CONSTRAINT "ServerBan_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServerBan" ADD CONSTRAINT "ServerBan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
