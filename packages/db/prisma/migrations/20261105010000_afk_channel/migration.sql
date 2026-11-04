-- Canal de ausentes (ADR-0049): quem fica parado em voz pelo tempo limite é movido para ele (o app desktop decide).
-- Reversão: ALTER TABLE "Server" DROP COLUMN "afkChannelId", DROP COLUMN "afkTimeoutSec";
ALTER TABLE "Server" ADD COLUMN "afkChannelId" UUID, ADD COLUMN "afkTimeoutSec" INTEGER NOT NULL DEFAULT 300;
