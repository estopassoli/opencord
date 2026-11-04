-- Configurações do servidor, parte 2 (ADR-0050): perfil (descrição, características, faixa), engajamento (canal do
-- sistema, boas-vindas, notificação padrão), fundo do convite, convites (validade, limite, pausa, convite usado por
-- quem entrou) e emojis personalizados. Tudo aditivo.
-- Reversão: DROP TABLE "ServerEmoji"; ALTER TABLE "Invite" DROP COLUMN "expiresAt", DROP COLUMN "maxUses";
--   ALTER TABLE "ServerMember" DROP COLUMN "inviteCode"; ALTER TABLE "Server" DROP COLUMN "description",
--   DROP COLUMN "traits", DROP COLUMN "bannerColor", DROP COLUMN "bannerKey", DROP COLUMN "inviteBgKey",
--   DROP COLUMN "systemChannelId", DROP COLUMN "welcomeEnabled", DROP COLUMN "defaultNotify", DROP COLUMN "invitesPaused";
ALTER TABLE "Server"
  ADD COLUMN "description" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "traits" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "bannerColor" TEXT,
  ADD COLUMN "bannerKey" TEXT,
  ADD COLUMN "inviteBgKey" TEXT,
  ADD COLUMN "systemChannelId" UUID,
  ADD COLUMN "welcomeEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "defaultNotify" TEXT NOT NULL DEFAULT 'all',
  ADD COLUMN "invitesPaused" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "ServerMember" ADD COLUMN "inviteCode" TEXT;

ALTER TABLE "Invite" ADD COLUMN "expiresAt" TIMESTAMPTZ(3), ADD COLUMN "maxUses" INTEGER;

CREATE TABLE "ServerEmoji" (
    "id" UUID NOT NULL,
    "serverId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "imageKey" TEXT NOT NULL,
    "animated" BOOLEAN NOT NULL DEFAULT false,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServerEmoji_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ServerEmoji_serverId_name_key" ON "ServerEmoji"("serverId", "name");
ALTER TABLE "ServerEmoji" ADD CONSTRAINT "ServerEmoji_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;
