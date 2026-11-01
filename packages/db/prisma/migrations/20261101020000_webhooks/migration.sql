-- Webhooks de entrada (ADR-0030). Aditiva: coluna com padrão e tabela nova.
-- Reverter: DROP TABLE "Webhook"; ALTER TABLE "User" DROP COLUMN "isWebhook"; (apagar os usuários isWebhook antes).
ALTER TABLE "User" ADD COLUMN "isWebhook" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Webhook" (
    "id" UUID NOT NULL,
    "serverId" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Webhook_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Webhook_token_key" ON "Webhook"("token");
CREATE UNIQUE INDEX "Webhook_userId_key" ON "Webhook"("userId");
CREATE INDEX "Webhook_serverId_idx" ON "Webhook"("serverId");

-- AddForeignKey
ALTER TABLE "Webhook" ADD CONSTRAINT "Webhook_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Webhook" ADD CONSTRAINT "Webhook_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Webhook" ADD CONSTRAINT "Webhook_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Webhook" ADD CONSTRAINT "Webhook_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
